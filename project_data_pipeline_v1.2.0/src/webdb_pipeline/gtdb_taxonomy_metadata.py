from __future__ import annotations

import argparse
import math
import re
from pathlib import Path

import pandas as pd


OUTPUT_COLUMNS = [
    "accession",
    "gtdb_taxonomy",
    "is_cultured",
    "if_refseq",
    "checkm2_completeness",
    "checkm2_contamination",
    "quality_score",
    "contig",
    "species_genome_count",
]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Convert GTDB release metadata tables into taxonomy metadata TSV files used by this project."
    )
    parser.add_argument(
        "inputs",
        nargs="+",
        type=Path,
        help="One or more GTDB metadata tables, such as ar53_metadata_r232.txt or bac120_metadata_r232.txt.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        required=True,
        help="Directory where converted taxonomy metadata TSV files will be written.",
    )
    parser.add_argument(
        "--cluster-map",
        type=Path,
        default=None,
        help=(
            "Optional TSV containing species-cluster information for inputs that do not include "
            "gtdb_genome_representative. The file must contain either "
            "(accession + gtdb_genome_representative) or (accession + species_genome_count)."
        ),
    )
    parser.add_argument(
        "--representatives-only",
        action="store_true",
        help="Keep only rows where gtdb_representative is true/t/1. Useful when the input file mixes representatives and non-representatives.",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    for input_path in args.inputs:
        output_path = args.output_dir / _default_output_dir_name(input_path) / "taxonomy.tsv"
        output_df = convert_gtdb_metadata_to_taxonomy_table(
            input_path,
            cluster_map_path=args.cluster_map,
            representatives_only=args.representatives_only,
        )
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_df.to_csv(output_path, sep="\t", index=False)
        print(f"Wrote {len(output_df)} rows -> {output_path}")


def convert_gtdb_metadata_to_taxonomy_table(
    path: Path,
    cluster_map_path: Path | None = None,
    representatives_only: bool = False,
) -> pd.DataFrame:
    df = pd.read_csv(path, sep="\t", dtype=str, keep_default_na=False)
    if representatives_only:
        df = _filter_representatives(df).reset_index(drop=True)
    taxonomy_series = _build_taxonomy_series(df)
    species_genome_count = _build_species_genome_count_series(df, cluster_map_path)

    result = pd.DataFrame(
        {
            "accession": _string_series(df, "accession"),
            "gtdb_taxonomy": taxonomy_series,
            "is_cultured": _build_is_cultured_series(df),
            "if_refseq": _build_if_refseq_series(df),
            "checkm2_completeness": _string_series(df, "checkm2_completeness"),
            "checkm2_contamination": _string_series(df, "checkm2_contamination"),
            "quality_score": _build_quality_score_series(df),
            "contig": _string_series(df, "contig_count", fallback="ncbi_contig_count"),
            "species_genome_count": species_genome_count.astype("int64").astype(str),
        }
    )
    result = result.loc[result["accession"].ne("") & result["gtdb_taxonomy"].ne("")].copy()
    result = result.drop_duplicates(subset=["accession"]).reset_index(drop=True)
    return result.loc[:, OUTPUT_COLUMNS]


def _filter_representatives(df: pd.DataFrame) -> pd.DataFrame:
    representative_col = next(
        (column for column in df.columns if str(column).strip().lower() == "gtdb_representative"),
        None,
    )
    if representative_col is None:
        raise KeyError("representatives_only was requested, but the input file has no gtdb_representative column.")
    normalized = df[representative_col].fillna("").astype(str).str.strip().str.lower()
    keep_mask = normalized.isin({"t", "true", "1", "yes", "y"})
    return df.loc[keep_mask].copy()


def _build_taxonomy_series(df: pd.DataFrame) -> pd.Series:
    if "gtdb_taxonomy" in df.columns:
        return _string_series(df, "gtdb_taxonomy")

    taxon_columns = [column for column in df.columns if re.fullmatch(r"Taxon(?:\.\d+)?", str(column)) is not None]
    if not taxon_columns:
        raise KeyError("Metadata table must contain either gtdb_taxonomy or split Taxon columns.")

    taxon_df = df.loc[:, taxon_columns].fillna("").astype(str).apply(lambda column: column.str.strip())
    return taxon_df.apply(lambda row: ";".join(value for value in row if value), axis=1)


def _build_representative_series(df: pd.DataFrame) -> pd.Series:
    representative = _string_series(df, "gtdb_genome_representative")
    accession = _string_series(df, "accession")
    return representative.where(representative.ne(""), accession)


def _build_species_genome_count_series(df: pd.DataFrame, cluster_map_path: Path | None) -> pd.Series:
    if cluster_map_path is None:
        representative = _string_series(df, "gtdb_genome_representative")
        if representative.ne("").any():
            representative = representative.where(representative.ne(""), _string_series(df, "accession"))
            return representative.groupby(representative).transform("size").astype("int64").astype(str)
        raise ValueError(
            "Input metadata does not contain gtdb_genome_representative, so species_genome_count "
            "cannot be derived safely. Provide --cluster-map with either "
            "(accession + gtdb_genome_representative) or (accession + species_genome_count)."
        )

    cluster_df = pd.read_csv(cluster_map_path, sep="\t", dtype=str, keep_default_na=False)
    lower_map = {str(column).strip().lower(): column for column in cluster_df.columns}
    accession_col = lower_map.get("accession")
    if accession_col is None:
        raise KeyError(f"Cluster map is missing accession column: {cluster_map_path}")

    if "species_genome_count" in lower_map:
        count_col = lower_map["species_genome_count"]
        merged = (
            pd.DataFrame({"accession": _string_series(df, "accession")})
            .merge(
                cluster_df.loc[:, [accession_col, count_col]].rename(
                    columns={accession_col: "accession", count_col: "species_genome_count"}
                ),
                on="accession",
                how="left",
            )
        )
        missing = merged.loc[merged["species_genome_count"].astype(str).str.strip().eq(""), "accession"].tolist()
        if missing:
            raise ValueError(
                f"Cluster map is missing species_genome_count for {len(missing)} accessions. "
                f"Examples: {missing[:10]}"
            )
        return merged["species_genome_count"].astype(str).str.strip()

    representative_col = lower_map.get("gtdb_genome_representative")
    if representative_col is None:
        raise KeyError(
            f"Cluster map must contain species_genome_count or gtdb_genome_representative: {cluster_map_path}"
        )
    representative_map = (
        cluster_df.loc[:, [accession_col, representative_col]]
        .rename(columns={accession_col: "accession", representative_col: "gtdb_genome_representative"})
    )
    representative_map["accession"] = representative_map["accession"].astype(str).str.strip()
    representative_map["gtdb_genome_representative"] = (
        representative_map["gtdb_genome_representative"].astype(str).str.strip()
    )
    representative_map = representative_map.loc[representative_map["accession"].ne("")].drop_duplicates(
        subset=["accession"]
    )
    cluster_sizes = (
        representative_map.loc[representative_map["gtdb_genome_representative"].ne("")]
        .groupby("gtdb_genome_representative")["accession"]
        .size()
        .astype("int64")
        .to_dict()
    )
    merged = (
        pd.DataFrame({"accession": _string_series(df, "accession")})
        .merge(representative_map, on="accession", how="left")
    )
    merged.index = df.index
    missing = merged.loc[merged["gtdb_genome_representative"].astype(str).str.strip().eq(""), "accession"].tolist()
    if missing:
        raise ValueError(
            f"Cluster map is missing representative assignments for {len(missing)} accessions. "
            f"Examples: {missing[:10]}"
        )
    return (
        merged["gtdb_genome_representative"]
        .astype(str)
        .str.strip()
        .map(cluster_sizes)
        .astype("int64")
        .astype(str)
    )


def _build_is_cultured_series(df: pd.DataFrame) -> pd.Series:
    category = _string_series(df, "ncbi_genome_category").str.lower()
    return category.eq("none").astype("int64").astype(str)


def _build_if_refseq_series(df: pd.DataFrame) -> pd.Series:
    accession = _string_series(df, "accession")
    return accession.str.startswith(("RS_GCF_", "GCF_")).astype("int64").astype(str)


def _build_quality_score_series(df: pd.DataFrame) -> pd.Series:
    completeness = pd.to_numeric(_string_series(df, "checkm2_completeness"), errors="coerce")
    contamination = pd.to_numeric(_string_series(df, "checkm2_contamination"), errors="coerce")
    n50 = pd.to_numeric(_string_series(df, "n50_contigs"), errors="coerce")

    quality = completeness - 5 * contamination
    valid_n50 = n50.where(n50 > 0)
    quality = quality + valid_n50.map(math.log10)
    return quality.map(lambda value: "" if pd.isna(value) else f"{float(value):.6f}".rstrip("0").rstrip("."))


def _string_series(df: pd.DataFrame, column: str, fallback: str | None = None) -> pd.Series:
    if column in df.columns:
        return df[column].fillna("").astype(str).str.strip()
    if fallback is not None and fallback in df.columns:
        return df[fallback].fillna("").astype(str).str.strip()
    return pd.Series([""] * len(df), index=df.index, dtype="string").fillna("")


def _default_output_dir_name(path: Path) -> str:
    stem = path.stem
    match = re.fullmatch(r"(.+)_metadata_(r\d+)", stem)
    if match is not None:
        prefix, release = match.groups()
        return f"{prefix}_{release}"
    return stem


if __name__ == "__main__":
    main()
