from __future__ import annotations

import csv
import os
import re
from pathlib import Path

import pandas as pd

from .models import ModuleSourceInput


def iter_protein_fasta_paths(protein_dir: Path) -> list[Path]:
    if not protein_dir.exists():
        return []

    fasta_paths: list[Path] = []
    visited_dirs: set[Path] = set()
    for current_root, dirnames, filenames in os.walk(protein_dir, followlinks=True):
        resolved_dir = _resolve_directory_path(Path(current_root))
        if resolved_dir is None:
            dirnames[:] = []
            continue
        if resolved_dir in visited_dirs:
            dirnames[:] = []
            continue
        visited_dirs.add(resolved_dir)

        kept_dirnames: list[str] = []
        for dirname in sorted(dirnames):
            child_path = Path(current_root) / dirname
            child_resolved = _resolve_directory_path(child_path)
            if child_resolved is None or child_resolved in visited_dirs:
                continue
            kept_dirnames.append(dirname)
        dirnames[:] = kept_dirnames

        for filename in sorted(filenames):
            child_path = Path(current_root) / filename
            try:
                if child_path.is_file() and child_path.suffix.lower() == ".faa":
                    fasta_paths.append(child_path)
            except OSError:
                continue
    return sorted(fasta_paths, key=lambda path: path.as_posix())


def _resolve_directory_path(path: Path) -> Path | None:
    try:
        resolved = path.resolve()
    except OSError:
        return None
    try:
        if resolved.is_dir():
            return resolved
    except OSError:
        return None
    return None


def genome_accession_from_protein_fasta_path(path: Path) -> str:
    stem = path.stem.strip()
    for suffix in ("_protein", ".protein", "-protein"):
        if stem.endswith(suffix):
            return stem[: -len(suffix)]
    return stem


KO_PATTERN = re.compile(r"K\d{5}")
MODULE_PATTERN = re.compile(r"M\d{5}")
MODULE_IR_VERSION = "semantic_ir_v1"

_GLOBAL_AST_NODES_BY_MODULE: dict[str, list[dict[str, object]]] = {}
_GLOBAL_AST_EDGES_BY_MODULE: dict[str, list[dict[str, object]]] = {}


def build_kegg_module_resources(
    module_source_input: ModuleSourceInput,
) -> dict[str, pd.DataFrame]:
    source_version = _read_module_source_version(module_source_input.info_path)
    module_name_map = _read_module_name_map(module_source_input.list_path)

    metadata_rows: list[dict[str, object]] = []
    column_rows: list[dict[str, object]] = []
    module_contexts: dict[str, dict[str, object]] = {}

    for module_id in sorted(module_name_map):
        entry_path = module_source_input.entries_dir / f"{module_id}.txt"
        if not entry_path.exists():
            continue
        fields = _parse_kegg_entry_fields(entry_path.read_text(encoding="utf-8"))
        module_name = _clean_kegg_module_name(fields.get("NAME", module_name_map.get(module_id, "")))
        definition = fields.get("DEFINITION", "")
        class_parts = [part.strip() for part in fields.get("CLASS", "").split(";") if part.strip()]
        metadata_rows.append(
            {
                "module_id": module_id,
                "module_name": module_name,
                "aliases": "",
                "search_text": " ".join(part for part in [module_id, module_name] if part).strip(),
                "module_class": class_parts[0] if len(class_parts) > 0 else "",
                "module_category": class_parts[1] if len(class_parts) > 1 else "",
                "module_subcategory": class_parts[2] if len(class_parts) > 2 else "",
                "description": definition,
                "source": "KEGG Module",
                "source_version": source_version,
            }
        )

        parse_result = ModuleExpressionParser(module_id, definition).parse()
        module_contexts[module_id] = {
            "ast_root_id": parse_result["root_id"],
            "ast_nodes": parse_result["nodes"],
            "ast_edges": parse_result["edges"],
        }

    ast_by_module = {module_id: context["ast_nodes"] for module_id, context in module_contexts.items()}
    ast_edge_by_module = {module_id: context["ast_edges"] for module_id, context in module_contexts.items()}
    global _GLOBAL_AST_NODES_BY_MODULE, _GLOBAL_AST_EDGES_BY_MODULE
    _GLOBAL_AST_NODES_BY_MODULE = ast_by_module
    _GLOBAL_AST_EDGES_BY_MODULE = ast_edge_by_module

    for module_id in sorted(module_contexts):
        context = module_contexts[module_id]
        semantic = _build_semantic_ir(
            module_id=module_id,
            ast_nodes=ast_by_module[module_id],
            ast_edges=ast_edge_by_module[module_id],
            ast_root_id=str(context["ast_root_id"]),
        )
        for step_summary in _derive_module_steps_from_semantic_ir(
            module_id=module_id,
            ast_nodes=ast_by_module[module_id],
            semantic=semantic,
        ):
            column_rows.extend(step_summary["column_rows"])

    module_metadata_df = pd.DataFrame(metadata_rows).drop_duplicates(subset=["module_id"]).reset_index(drop=True)
    module_column_registry_df = pd.DataFrame(column_rows).drop_duplicates(
        subset=["module_column_id"]
    ).reset_index(drop=True)

    return {
        "module_metadata_df": module_metadata_df,
        "module_column_registry_df": module_column_registry_df,
    }


def _read_module_source_version(path: Path) -> str:
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith("md"):
            return stripped.partition("md")[2].strip()
    return ""


def _read_module_name_map(path: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle, delimiter="\t")
        for row in reader:
            if len(row) < 2:
                continue
            module_id = row[0].strip()
            module_name = _clean_kegg_module_name(row[1].strip())
            if module_id:
                result[module_id] = module_name
    return result


def _clean_kegg_module_name(value: str) -> str:
    text = " ".join(str(value).strip().split())
    if not text:
        return ""
    arrow_index = text.find("=>")
    if arrow_index < 0:
        arrow_index = text.find("\u2192")
    if arrow_index < 0:
        return text
    comma_index = text.rfind(",", 0, arrow_index)
    if comma_index >= 0:
        return text[:comma_index].strip().rstrip(",")
    return text[:arrow_index].strip().rstrip(",")


def _parse_kegg_entry_fields(text: str) -> dict[str, str]:
    fields: dict[str, list[str]] = {}
    current_key = ""
    for raw_line in text.splitlines():
        if raw_line.strip() == "///":
            break
        key = raw_line[:12].strip()
        value = raw_line[12:].strip() if len(raw_line) > 12 else ""
        if key:
            current_key = key
            fields.setdefault(key, []).append(value)
        elif current_key:
            fields.setdefault(current_key, []).append(value)
    return {key: " ".join(part for part in values if part).strip() for key, values in fields.items()}


class ModuleExpressionParser:
    def __init__(self, module_id: str, expression: str) -> None:
        self.module_id = module_id
        self.expression = expression or ""
        self.tokens = self._tokenize()
        self.index = 0
        self.node_counter = 0
        self.edge_counter = 0
        self.nodes: list[dict[str, object]] = []
        self.edges: list[dict[str, object]] = []
        self.node_lookup: dict[str, dict[str, object]] = {}

    def parse(self) -> dict[str, object]:
        if not self.expression.strip():
            root_id = self._new_node(
                node_type="group",
                node_subtype="empty_expression",
                node_value="",
                start_offset=0,
                end_offset=0,
            )
            self.node_lookup[root_id]["is_root"] = 1
            return {"root_id": root_id, "nodes": self.nodes, "edges": self.edges}

        root_id = self._parse_sequence()
        if self._peek() is not None:
            token = self._peek()
            raise ValueError(
                f"{self.module_id}: unexpected token {token['type']} at offset {token['start']}"
            )
        self.node_lookup[root_id]["is_root"] = 1
        return {"root_id": root_id, "nodes": self.nodes, "edges": self.edges}

    def _tokenize(self) -> list[dict[str, object]]:
        tokens: list[dict[str, object]] = []
        text = self.expression
        length = len(text)
        pos = 0
        prev_can_end = False
        while pos < length:
            char = text[pos]
            if char.isspace():
                start = pos
                while pos < length and text[pos].isspace():
                    pos += 1
                next_char = text[pos] if pos < length else ""
                if prev_can_end and next_char and (next_char == "(" or next_char.isalnum()):
                    tokens.append({"type": "SEQ", "value": " ", "start": start, "end": pos})
                continue
            if char == "(":
                tokens.append({"type": "LPAREN", "value": char, "start": pos, "end": pos + 1})
                pos += 1
                prev_can_end = False
                continue
            if char == ")":
                tokens.append({"type": "RPAREN", "value": char, "start": pos, "end": pos + 1})
                pos += 1
                prev_can_end = True
                continue
            if char == "+":
                tokens.append({"type": "PLUS", "value": char, "start": pos, "end": pos + 1})
                pos += 1
                prev_can_end = False
                continue
            if char == ",":
                tokens.append({"type": "COMMA", "value": char, "start": pos, "end": pos + 1})
                pos += 1
                prev_can_end = False
                continue
            if char == "-":
                tokens.append({"type": "MINUS", "value": char, "start": pos, "end": pos + 1})
                pos += 1
                prev_can_end = False
                continue
            ko_match = KO_PATTERN.match(text, pos)
            if ko_match:
                value = ko_match.group(0)
                tokens.append(
                    {"type": "KO", "value": value, "start": ko_match.start(), "end": ko_match.end()}
                )
                pos = ko_match.end()
                prev_can_end = True
                continue
            module_match = MODULE_PATTERN.match(text, pos)
            if module_match:
                value = module_match.group(0)
                tokens.append(
                    {
                        "type": "MODULE",
                        "value": value,
                        "start": module_match.start(),
                        "end": module_match.end(),
                    }
                )
                pos = module_match.end()
                prev_can_end = True
                continue
            tokens.append({"type": "LITERAL", "value": char, "start": pos, "end": pos + 1})
            pos += 1
            prev_can_end = True
        return tokens

    def _peek(self) -> dict[str, object] | None:
        return self.tokens[self.index] if self.index < len(self.tokens) else None

    def _consume(self, expected_type: str | None = None) -> dict[str, object]:
        token = self._peek()
        if token is None:
            raise ValueError(f"{self.module_id}: unexpected end of expression")
        if expected_type is not None and str(token["type"]) != expected_type:
            raise ValueError(
                f"{self.module_id}: expected {expected_type}, found {token['type']} at {token['start']}"
            )
        self.index += 1
        return token

    def _parse_sequence(self) -> str:
        node_id = self._parse_choice()
        while self._peek() is not None and self._peek()["type"] == "SEQ":
            token = self._consume("SEQ")
            right_id = self._parse_choice()
            node_id = self._combine_associative(
                operator_subtype="sequence_op",
                left_id=node_id,
                right_id=right_id,
                separator_token=token,
                edge_label="operand",
            )
        return node_id

    def _parse_choice(self) -> str:
        node_id = self._parse_complex()
        while self._peek() is not None and self._peek()["type"] == "COMMA":
            token = self._consume("COMMA")
            right_id = self._parse_complex()
            node_id = self._combine_associative(
                operator_subtype="comma_op",
                left_id=node_id,
                right_id=right_id,
                separator_token=token,
                edge_label="operand",
            )
        return node_id

    def _parse_complex(self) -> str:
        node_id = self._parse_primary()
        while self._peek() is not None and self._peek()["type"] in {"PLUS", "MINUS"}:
            token = self._consume()
            if token["type"] == "PLUS":
                right_id = self._parse_primary()
                node_id = self._combine_associative(
                    operator_subtype="plus_op",
                    left_id=node_id,
                    right_id=right_id,
                    separator_token=token,
                    edge_label="operand",
                )
            else:
                if self._peek() is None or self._peek()["type"] in {"RPAREN", "COMMA", "SEQ"}:
                    right_id = self._new_node(
                        node_type="reference",
                        node_subtype="literal",
                        node_value="",
                        start_offset=int(token["end"]),
                        end_offset=int(token["end"]),
                    )
                else:
                    right_id = self._parse_primary()
                node_id = self._combine_binary_minus(node_id, right_id, token)
        return node_id

    def _parse_primary(self) -> str:
        token = self._peek()
        if token is None:
            raise ValueError(f"{self.module_id}: unexpected end while parsing primary")
        token_type = str(token["type"])
        if token_type == "KO":
            token = self._consume("KO")
            return self._new_node(
                node_type="reference",
                node_subtype="ko",
                node_value=str(token["value"]),
                start_offset=int(token["start"]),
                end_offset=int(token["end"]),
            )
        if token_type == "MODULE":
            token = self._consume("MODULE")
            return self._new_node(
                node_type="reference",
                node_subtype="module_ref",
                node_value=str(token["value"]),
                start_offset=int(token["start"]),
                end_offset=int(token["end"]),
            )
        if token_type == "LITERAL":
            token = self._consume("LITERAL")
            return self._new_node(
                node_type="reference",
                node_subtype="literal",
                node_value=str(token["value"]),
                start_offset=int(token["start"]),
                end_offset=int(token["end"]),
            )
        if token_type == "MINUS":
            first = self._consume("MINUS")
            last = first
            minus_count = 1
            while self._peek() is not None and self._peek()["type"] == "MINUS":
                last = self._consume("MINUS")
                minus_count += 1
            if self._peek() is None or self._peek()["type"] in {"RPAREN", "COMMA", "SEQ"}:
                child_id = self._new_node(
                    node_type="reference",
                    node_subtype="literal",
                    node_value="",
                    start_offset=int(last["end"]),
                    end_offset=int(last["end"]),
                )
            else:
                child_id = self._parse_primary()
            child_node = self.node_lookup[child_id]
            node_id = self._new_node(
                node_type="operator",
                node_subtype="prefix_minus_op",
                node_value="-" * minus_count,
                start_offset=int(first["start"]),
                end_offset=int(child_node["end_offset"]),
            )
            self._add_edge(node_id, child_id, "optional", 1)
            return node_id
        if token_type == "LPAREN":
            left = self._consume("LPAREN")
            child_id = self._parse_sequence()
            right = self._consume("RPAREN")
            group_id = self._new_node(
                node_type="group",
                node_subtype="parenthesized_group",
                node_value="",
                start_offset=int(left["start"]),
                end_offset=int(right["end"]),
            )
            self._add_edge(group_id, child_id, "wrapped", 1)
            return group_id
        raise ValueError(
            f"{self.module_id}: unsupported token {token_type} at offset {token['start']}"
        )

    def _combine_associative(
        self,
        operator_subtype: str,
        left_id: str,
        right_id: str,
        separator_token: dict[str, object],
        edge_label: str,
    ) -> str:
        left_node = self.node_lookup[left_id]
        right_node = self.node_lookup[right_id]
        if left_node["node_type"] == "operator" and left_node["node_subtype"] == operator_subtype:
            self._add_edge(left_id, right_id, edge_label, self._next_child_order(left_id))
            left_node["end_offset"] = int(right_node["end_offset"])
            left_node["raw_text"] = self.expression[int(left_node["start_offset"]) : int(right_node["end_offset"])]
            return left_id
        node_id = self._new_node(
            node_type="operator",
            node_subtype=operator_subtype,
            node_value=str(separator_token["value"]),
            start_offset=int(left_node["start_offset"]),
            end_offset=int(right_node["end_offset"]),
        )
        self._add_edge(node_id, left_id, edge_label, 1)
        self._add_edge(node_id, right_id, edge_label, 2)
        return node_id

    def _combine_binary_minus(self, left_id: str, right_id: str, separator_token: dict[str, object]) -> str:
        left_node = self.node_lookup[left_id]
        right_node = self.node_lookup[right_id]
        node_id = self._new_node(
            node_type="operator",
            node_subtype="minus_op",
            node_value=str(separator_token["value"]),
            start_offset=int(left_node["start_offset"]),
            end_offset=int(right_node["end_offset"]),
        )
        self._add_edge(node_id, left_id, "required", 1)
        self._add_edge(node_id, right_id, "optional", 2)
        return node_id

    def _next_child_order(self, parent_id: str) -> int:
        return 1 + sum(1 for edge in self.edges if edge["parent_node_id"] == parent_id)

    def _new_node(
        self,
        node_type: str,
        node_subtype: str,
        node_value: str,
        start_offset: int,
        end_offset: int,
    ) -> str:
        self.node_counter += 1
        node_id = f"{self.module_id}:ast:{self.node_counter:05d}"
        raw_text = self.expression[start_offset:end_offset] if end_offset > start_offset else ""
        row = {
            "node_id": node_id,
            "module_id": self.module_id,
            "node_type": node_type,
            "node_subtype": node_subtype,
            "node_value": node_value,
            "raw_text": raw_text,
            "start_offset": start_offset,
            "end_offset": end_offset,
            "is_root": 0,
        }
        self.nodes.append(row)
        self.node_lookup[node_id] = row
        return node_id

    def _add_edge(self, parent_id: str, child_id: str, edge_label: str, child_order: int) -> None:
        self.edge_counter += 1
        self.edges.append(
            {
                "edge_id": f"{self.module_id}:ast_edge:{self.edge_counter:05d}",
                "module_id": self.module_id,
                "parent_node_id": parent_id,
                "child_node_id": child_id,
                "edge_label": edge_label,
                "child_order": child_order,
            }
        )


def _build_semantic_ir(
    module_id: str,
    ast_nodes: list[dict[str, object]],
    ast_edges: list[dict[str, object]],
    ast_root_id: str,
) -> dict[str, object]:
    ast_node_map = {str(node["node_id"]): node for node in ast_nodes}
    child_edges_by_parent: dict[str, list[dict[str, object]]] = {}
    for edge in ast_edges:
        child_edges_by_parent.setdefault(str(edge["parent_node_id"]), []).append(edge)
    for edges in child_edges_by_parent.values():
        edges.sort(key=lambda item: int(item["child_order"]))

    ir_nodes: list[dict[str, object]] = []
    ir_edges: list[dict[str, object]] = []
    ir_lookup: dict[str, dict[str, object]] = {}
    edge_counter = 0

    def convert(ast_node_id: str) -> str:
        nonlocal edge_counter
        if ast_node_id in ir_lookup:
            return str(ir_lookup[ast_node_id]["node_id"])
        ast_node = ast_node_map[ast_node_id]
        ir_node_id = ast_node_id.replace(":ast:", ":ir:")
        row = {
            "node_id": ir_node_id,
            "module_id": module_id,
            "source_ast_node_id": ast_node_id,
            "semantic_type": _map_ast_to_semantic_type(ast_node),
            "node_value": ast_node["node_value"],
            "raw_text": ast_node["raw_text"],
            "is_root": 1 if ast_node_id == ast_root_id else 0,
        }
        ir_nodes.append(row)
        ir_lookup[ast_node_id] = row
        for edge in child_edges_by_parent.get(ast_node_id, []):
            child_ir_id = convert(str(edge["child_node_id"]))
            edge_counter += 1
            ir_edges.append(
                {
                    "edge_id": f"{module_id}:ir_edge:{edge_counter:05d}",
                    "from_node_id": ir_node_id,
                    "to_node_id": child_ir_id,
                    "edge_label": edge["edge_label"],
                    "child_order": edge["child_order"],
                }
            )
        return ir_node_id

    root_ir_id = convert(ast_root_id)
    root_row = next(node for node in ir_nodes if node["node_id"] == root_ir_id)
    return {
        "ir_nodes": ir_nodes,
        "ir_edges": ir_edges,
        "root_ir_id": root_ir_id,
        "ir_version": MODULE_IR_VERSION,
        "completeness_blocks": _build_completeness_blocks(module_id, root_row, ir_edges, ir_nodes),
    }


def _map_ast_to_semantic_type(ast_node: dict[str, object]) -> str:
    node_type = str(ast_node["node_type"])
    node_subtype = str(ast_node["node_subtype"])
    if node_type == "reference":
        if node_subtype == "ko":
            return "ko"
        if node_subtype == "module_ref":
            return "module_ref"
        if node_subtype == "literal":
            return "literal"
        return "unknown_ref"
    if node_type == "group":
        return "group"
    if node_subtype == "sequence_op":
        return "sequence_and"
    if node_subtype == "plus_op":
        return "complex_and"
    if node_subtype == "comma_op":
        return "alternative"
    if node_subtype == "minus_op":
        return "optional_attachment"
    if node_subtype == "prefix_minus_op":
        return "optional_prefix"
    return "unknown"


def _build_completeness_blocks(
    module_id: str,
    root_ir_node: dict[str, object],
    ir_edges: list[dict[str, object]],
    ir_nodes: list[dict[str, object]],
) -> list[dict[str, object]]:
    node_lookup = {str(node["node_id"]): node for node in ir_nodes}
    child_edges = [edge for edge in ir_edges if edge["from_node_id"] == root_ir_node["node_id"]]
    child_edges.sort(key=lambda item: int(item["child_order"]))
    if root_ir_node["semantic_type"] == "sequence_and" and child_edges:
        source_nodes = [node_lookup[str(edge["to_node_id"])] for edge in child_edges]
    else:
        source_nodes = [root_ir_node]

    rows: list[dict[str, object]] = []
    for display_order, node in enumerate(source_nodes, start=1):
        rows.append(
            {
                "module_id": module_id,
                "completeness_block_id": f"{module_id}_CB{display_order:02d}",
                "display_order": display_order,
                "source_ir_node_id": node["node_id"],
                "source_ast_node_id": node["source_ast_node_id"],
                "raw_expression": node["raw_text"],
                "ir_version": MODULE_IR_VERSION,
            }
        )
    return rows


def _expand_module_reference(
    module_id: str,
    ast_nodes_by_module: dict[str, list[dict[str, object]]],
    ast_edges_by_module: dict[str, list[dict[str, object]]],
    module_stack: list[str],
    module_path: list[str],
) -> list[dict[str, object]]:
    if module_id in module_stack:
        return [
            {
                "target_type": "module_ref",
                "target_id": module_id,
                "expansion_depth": max(0, len(module_path) - 1),
                "expansion_path": ">".join(module_path),
                "expanded_leaf_node_id": "",
                "is_cyclic": 1,
                "expansion_status": "cyclic_reference",
            }
        ]
    ast_nodes = ast_nodes_by_module.get(module_id)
    ast_edges = ast_edges_by_module.get(module_id)
    if not ast_nodes:
        return [
            {
                "target_type": "module_ref",
                "target_id": module_id,
                "expansion_depth": max(0, len(module_path) - 1),
                "expansion_path": ">".join(module_path),
                "expanded_leaf_node_id": "",
                "is_cyclic": 0,
                "expansion_status": "missing_module",
            }
        ]
    node_lookup = {str(node["node_id"]): node for node in ast_nodes}
    child_edges_by_parent: dict[str, list[dict[str, object]]] = {}
    root_ids: list[str] = []
    for node in ast_nodes:
        if int(node.get("is_root", 0)) == 1:
            root_ids.append(str(node["node_id"]))
    for edge in ast_edges:
        child_edges_by_parent.setdefault(str(edge["parent_node_id"]), []).append(edge)
    for edges in child_edges_by_parent.values():
        edges.sort(key=lambda item: int(item["child_order"]))
    root_id = root_ids[0] if root_ids else str(ast_nodes[0]["node_id"])
    return _collect_expanded_targets_from_ast(
        node_id=root_id,
        node_lookup=node_lookup,
        child_edges_by_parent=child_edges_by_parent,
        ast_nodes_by_module=ast_nodes_by_module,
        ast_edges_by_module=ast_edges_by_module,
        module_stack=module_stack + [module_id],
        module_path=module_path,
        optional_flag=False,
    )


def _collect_expanded_targets_from_ast(
    node_id: str,
    node_lookup: dict[str, dict[str, object]],
    child_edges_by_parent: dict[str, list[dict[str, object]]],
    ast_nodes_by_module: dict[str, list[dict[str, object]]],
    ast_edges_by_module: dict[str, list[dict[str, object]]],
    module_stack: list[str],
    module_path: list[str],
    optional_flag: bool,
) -> list[dict[str, object]]:
    node = node_lookup[node_id]
    if node["node_type"] == "reference" and node["node_subtype"] == "ko":
        return [
            {
                "target_type": "ko",
                "target_id": node["node_value"],
                "expansion_depth": max(0, len(module_path) - 1),
                "expansion_path": ">".join(module_path),
                "expanded_leaf_node_id": node_id,
                "is_cyclic": 0,
                "expansion_status": "expanded",
                "is_optional": 1 if optional_flag else 0,
            }
        ]
    if node["node_type"] == "reference" and node["node_subtype"] == "module_ref":
        referenced_module = str(node["node_value"])
        if referenced_module in module_stack:
            return [
                {
                    "target_type": "module_ref",
                    "target_id": referenced_module,
                    "expansion_depth": max(0, len(module_path)),
                    "expansion_path": ">".join(module_path + [referenced_module]),
                    "expanded_leaf_node_id": "",
                    "is_cyclic": 1,
                    "expansion_status": "cyclic_reference",
                    "is_optional": 1 if optional_flag else 0,
                }
            ]
        return _expand_module_reference(
            referenced_module,
            ast_nodes_by_module,
            ast_edges_by_module,
            module_stack=module_stack,
            module_path=module_path + [referenced_module],
        )

    rows: list[dict[str, object]] = []
    for edge in child_edges_by_parent.get(node_id, []):
        child_optional = optional_flag or edge["edge_label"] == "optional"
        rows.extend(
            _collect_expanded_targets_from_ast(
                node_id=str(edge["child_node_id"]),
                node_lookup=node_lookup,
                child_edges_by_parent=child_edges_by_parent,
                ast_nodes_by_module=ast_nodes_by_module,
                ast_edges_by_module=ast_edges_by_module,
                module_stack=module_stack,
                module_path=module_path,
                optional_flag=child_optional,
            )
        )
    return rows


def _derive_module_steps_from_semantic_ir(
    module_id: str,
    ast_nodes: list[dict[str, object]],
    semantic: dict[str, object],
) -> list[dict[str, object]]:
    ast_node_lookup = {str(node["node_id"]): node for node in ast_nodes}
    step_summaries: list[dict[str, object]] = []
    for block in semantic["completeness_blocks"]:
        step_index = int(block["display_order"])
        step_id = f"{module_id}_S{step_index:02d}"
        source_ast_node_id = str(block["source_ast_node_id"])
        source_ir_node_id = str(block["source_ir_node_id"])
        source_group_id = source_ast_node_id
        step_logic = _semantic_type_to_step_logic(
            _resolve_step_semantic_type(semantic["ir_nodes"], semantic["ir_edges"], source_ir_node_id)
        )
        columns = _collect_display_columns_for_step(
            module_id=module_id,
            step_id=step_id,
            completeness_block_id=str(block["completeness_block_id"]),
            source_ast_node_id=source_ast_node_id,
            source_group_id=source_group_id,
            ast_node_lookup=ast_node_lookup,
        )
        column_rows_local: list[dict[str, object]] = []
        for ko_order_in_step, column in enumerate(columns, start=1):
            column_rows_local.append(
                {
                    "module_column_id": column["module_column_id"],
                    "module_id": module_id,
                    "step_id": step_id,
                    "step_index": step_index,
                    "display_order": step_index,
                    "ko_id": column["ko_id"],
                    "ko_order_in_step": ko_order_in_step,
                    "column_label": column["ko_id"],
                    "step_logic": step_logic,
                    "is_optional": column["is_optional"],
                    "source_node_id": column["source_node_id"],
                    "source_group_id": source_group_id,
                    "display_path": column["display_path"],
                    "semantic_path": column["semantic_path"],
                    "completeness_block_id": block["completeness_block_id"],
                }
            )
        step_summaries.append({"column_rows": column_rows_local})
    return step_summaries


def _resolve_step_semantic_type(
    ir_nodes: list[dict[str, object]],
    ir_edges: list[dict[str, object]],
    node_id: str,
) -> str:
    node_lookup = {str(node["node_id"]): node for node in ir_nodes}
    edge_lookup: dict[str, list[dict[str, object]]] = {}
    for edge in ir_edges:
        edge_lookup.setdefault(str(edge["from_node_id"]), []).append(edge)
    for edges in edge_lookup.values():
        edges.sort(key=lambda item: int(item["child_order"]))

    current_id = node_id
    visited: set[str] = set()
    while current_id not in visited:
        visited.add(current_id)
        node = node_lookup.get(current_id)
        if node is None:
            return "unknown"
        semantic_type = str(node["semantic_type"])
        if semantic_type != "group":
            return semantic_type
        children = edge_lookup.get(current_id, [])
        if len(children) != 1:
            return semantic_type
        current_id = str(children[0]["to_node_id"])
    return "unknown"


def _semantic_type_to_step_logic(semantic_type: str) -> str:
    mapping = {
        "ko": "single",
        "module_ref": "module_ref",
        "group": "group",
        "sequence_and": "sequence",
        "complex_and": "complex",
        "alternative": "or",
        "optional_attachment": "optional",
        "optional_prefix": "optional",
    }
    return mapping.get(semantic_type, "unknown")


def _collect_display_columns_for_step(
    module_id: str,
    step_id: str,
    completeness_block_id: str,
    source_ast_node_id: str,
    source_group_id: str,
    ast_node_lookup: dict[str, dict[str, object]],
) -> list[dict[str, object]]:
    columns: list[dict[str, object]] = []
    module_ref_sequence = 0

    def walk(node_id: str, path_parts: list[str], optional_flag: bool) -> None:
        nonlocal module_ref_sequence
        node = ast_node_lookup[node_id]
        node_type = str(node["node_type"])
        node_subtype = str(node["node_subtype"])
        path_now = path_parts + [node_id]
        if node_type == "reference" and node_subtype == "ko":
            columns.append(
                {
                    "module_column_id": f"{step_id}_{node_id.split(':')[-1]}_{node['node_value']}_{len(columns)+1:03d}",
                    "ko_id": node["node_value"],
                    "is_optional": 1 if optional_flag else 0,
                    "source_node_id": node_id,
                    "source_group_id": source_group_id,
                    "display_path": ">".join(path_now),
                    "semantic_path": f"{module_id}>{step_id}>{node['node_value']}",
                    "completeness_block_id": completeness_block_id,
                }
            )
            return
        if node_type == "reference" and node_subtype == "module_ref":
            module_ref_sequence += 1
            expansions = _expand_module_reference(
                str(node["node_value"]),
                _GLOBAL_AST_NODES_BY_MODULE,
                _GLOBAL_AST_EDGES_BY_MODULE,
                module_stack=[module_id],
                module_path=[module_id, str(node["node_value"])],
            )
            for expansion_index, expansion in enumerate(expansions, start=1):
                if expansion["target_type"] != "ko":
                    continue
                columns.append(
                    {
                        "module_column_id": (
                            f"{step_id}_{node_id.split(':')[-1]}_{expansion['target_id']}_"
                            f"{module_ref_sequence:03d}_{expansion_index:03d}"
                        ),
                        "ko_id": expansion["target_id"],
                        "is_optional": 1 if optional_flag or int(expansion.get("is_optional", 0)) else 0,
                        "source_node_id": node_id,
                        "source_group_id": source_group_id,
                        "display_path": ">".join(path_now),
                        "semantic_path": expansion["expansion_path"],
                        "completeness_block_id": completeness_block_id,
                    }
                )
            return

        child_edges = [
            edge for edge in _GLOBAL_AST_EDGES_BY_MODULE[module_id] if edge["parent_node_id"] == node_id
        ]
        child_edges.sort(key=lambda item: int(item["child_order"]))
        for edge in child_edges:
            walk(str(edge["child_node_id"]), path_now, optional_flag or edge["edge_label"] == "optional")

    walk(source_ast_node_id, [], False)
    return columns
