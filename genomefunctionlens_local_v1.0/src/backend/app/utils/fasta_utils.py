from collections.abc import Iterable, Mapping
from pathlib import Path


def wrap_sequence(sequence: str, width: int = 80) -> str:
    return "\n".join(sequence[i : i + width] for i in range(0, len(sequence), width))


def write_fasta_file(output_path: Path, proteins: Iterable[Mapping[str, str]]) -> int:
    count = 0
    with output_path.open("w", encoding="utf-8", newline="\n") as handle:
        for protein in proteins:
            handle.write(f">{protein['header']}\n")
            handle.write(wrap_sequence(protein["sequence"]))
            handle.write("\n")
            count += 1
    return count
