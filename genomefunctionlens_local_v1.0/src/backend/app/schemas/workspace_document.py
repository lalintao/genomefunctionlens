"""Canvas archive contract. New writes use V3; V2 remains readable for migration."""
from typing import Annotated, Any, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

NodeId = Annotated[int, Field(strict=True, ge=0)]
Positive = Annotated[float, Field(gt=0, allow_inf_nan=False)]
Finite = Annotated[float, Field(allow_inf_nan=False)]
Mode = Literal["rectangular", "circular"]

class DocumentModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

class Dataset(DocumentModel):
    speciesTree: str
    genomeDatabase: str
    datasetRevision: str

class Reroot(DocumentModel):
    edgeNodeIdA: NodeId
    edgeNodeIdB: NodeId
    position: Annotated[float, Field(ge=0, le=1)]

class RankConstraint(DocumentModel):
    nodeId: NodeId
    expandRank: str
    taxonRank: str | None = None
    taxonName: str | None = None

class RankRule(RankConstraint):
    enabled: bool

class Terminal(DocumentModel):
    nodeId: NodeId
    rank: str
    label: str
    collapseCeilingRank: str
    ownedLeafNodeIds: Annotated[list[NodeId], Field(min_length=1)]

class TreeDocument(DocumentModel):
    rerootSpec: Reroot
    swappedBranchNodeIds: list[NodeId]
    aliveLeafNodeIds: list[NodeId]
    displayRank: str
    stripRank: str
    localRankRules: list[RankRule]
    localRankConstraints: list[RankConstraint]
    terminalNodeTable: list[Terminal]
    customTerminalLabels: list[tuple[NodeId, str]]
    viewRootNodeId: NodeId | None

    @model_validator(mode="after")
    def validate_cut(self):
        alive = set(self.aliveLeafNodeIds)
        if len(alive) != len(self.aliveLeafNodeIds) or len(set(self.swappedBranchNodeIds)) != len(self.swappedBranchNodeIds):
            raise ValueError("duplicate tree ids")
        nodes, owned = set(), set()
        for row in self.terminalNodeTable:
            if row.nodeId in nodes:
                raise ValueError("duplicate terminal node")
            nodes.add(row.nodeId)
            for leaf in row.ownedLeafNodeIds:
                if leaf not in alive or leaf in owned:
                    raise ValueError("invalid terminal ownership")
                owned.add(leaf)
        if self.viewRootNodeId is None and owned != alive:
            raise ValueError("terminal cut does not cover the saved scope")
        return self

class Column(BaseModel):
    # Biological display metadata evolves independently of the archive envelope.
    model_config = ConfigDict(extra="allow", allow_inf_nan=False)
    type: str
    value: str
    label: str
    column_id: str | None = None
    annotation_id: NodeId | None = None

class ModuleGroup(DocumentModel):
    module_id: str
    module_name: str
    column_ids: list[str]
    completeness_column_id: str | None = None
    detail_column_ids: list[str] | None = None
    ko_values: list[str] | None = None

class QueryResult(DocumentModel):
    species_tree: str
    genome_database: str
    columns: list[Column]
    module_groups: list[ModuleGroup]

class ColumnSlot(DocumentModel):
    slotId: str
    columnKey: str
    slotIndex: Annotated[int, Field(ge=0)]
    reserveTrailingGap: bool | None = None

class Query(DocumentModel):
    resultSession: QueryResult
    columnSlots: list[ColumnSlot]

    @model_validator(mode="after")
    def validate_columns(self):
        keys = [column.column_id or f"{column.type}|{column.value}" for column in self.resultSession.columns]
        known = set(keys)
        if len(known) != len(keys):
            raise ValueError("duplicate query column")
        slots = [slot.columnKey for slot in self.columnSlots]
        if len(set(slots)) != len(slots) or set(slots) != known:
            raise ValueError("column slots must cover each column once")
        if len({slot.slotId for slot in self.columnSlots}) != len(slots) or len({slot.slotIndex for slot in self.columnSlots}) != len(slots):
            raise ValueError("duplicate column slot")
        for group in self.resultSession.module_groups:
            if not set(group.column_ids).issubset(known) or not set(group.detail_column_ids or []).issubset(known):
                raise ValueError("invalid module column reference")
            if group.completeness_column_id and group.completeness_column_id not in known:
                raise ValueError("invalid completeness column")
        return self

class CartBatch(DocumentModel):
    id: int
    sourceType: Literal["manual", "heatmap"]
    ancestorNodeId: NodeId | None
    ancestorLabel: str
    ancestorRank: str
    expandRank: str
    recordCount: Annotated[int, Field(ge=0)]

class CartRecord(DocumentModel):
    id: str
    nodeId: NodeId
    label: str
    taxonLabel: str
    rank: str | None
    expandRank: str
    ancestorNodeId: NodeId | None
    ancestorLabel: str
    ancestorRank: str
    path: str
    leafCount: Annotated[int, Field(ge=0)]
    fullTreeLeafCount: Annotated[int, Field(ge=0)]
    leafNodeIds: list[NodeId]
    isExactNodeScope: bool
    batchId: int
    sourceType: Literal["manual", "heatmap"]
    scopeSource: Literal["current_view", "database"]

class Cart(DocumentModel):
    aliveLeafNodeIds: list[NodeId]
    records: list[CartRecord]
    batches: list[CartBatch]

class TaxonOverride(DocumentModel):
    rank: str
    label: str

class TreeStyle(DocumentModel):
    id: str
    createdOrder: int
    kind: Literal["label", "branch", "background", "strip"]
    color: str
    name: str
    nodeId: NodeId
    nodeIds: list[NodeId]
    source: Literal["manual", "taxon"] | None = None
    taxonRank: str | None = None
    taxonLabel: str | None = None
    taxonOverrides: list[TaxonOverride] | None = None

class ColorStop(DocumentModel):
    upperBound: Finite | None
    upperBoundExclusive: bool | None = None
    color: str

class ColorScale(DocumentModel):
    stops: Annotated[list[ColorStop], Field(min_length=1, max_length=1024)]

class ColorScales(DocumentModel):
    count: ColorScale
    ratio: ColorScale

class HeatmapStyle(DocumentModel):
    id: str
    role: Literal["default", "selection"]
    treeViewMode: Mode
    paletteId: str
    colorScales: ColorScales | None = None
    shape: Literal["fill", "circle", "triangle", "square"]
    borderMode: Literal["none", "outer", "inner"]
    name: str
    leafCellKeys: list[str]

class Heatmap(DocumentModel):
    metric: Literal["count", "ratio"]
    ratioDisplayMode: Literal["fraction", "percent"]
    showNumbers: bool
    shapeSize: Annotated[float, Field(ge=0.1, le=1)]
    columnLabelParts: list[Literal["value", "short_name", "full_name"]]
    styles: list[HeatmapStyle]
    selectedCellKeys: list[str]
    activeModuleId: str
    showModuleNames: bool
    showModuleFullName: bool
    showModuleCompleteness: bool
    showModuleDetail: bool
    moduleCompletenessThreshold: str

class FontProfile(DocumentModel):
    branchLabel: Positive
    branchLength: Positive
    speciesCount: Positive
    stripLabel: Positive
    heatmapValue: Positive
    heatmapColumnLabel: Positive
    moduleLabel: Positive

class Appearance(DocumentModel):
    treeViewMode: Mode
    showStrip: bool
    taxonDisplayStyle: Literal["strip", "background"]
    taxonNameDisplayMode: Literal["embedded", "annotation"]
    taxonLegendFontSize: Positive
    rectangularTaxonLegendFontSize: Positive
    circularTaxonLegendFontSize: Positive
    heatmapLegendFontSize: Positive
    rectangularHeatmapLegendFontSize: Positive
    circularHeatmapLegendFontSize: Positive
    branchScale: Positive
    spacingScale: Positive
    showStripLabels: bool
    stripMinimumLeafCount: Annotated[int, Field(ge=0)]
    showSpeciesCount: bool
    showBranchLabels: bool
    forceShowBranchLabels: bool
    forceShowStripLabels: bool
    forceShowSpeciesCount: bool
    branchStrokeWidth: Positive
    rectangularFontProfile: FontProfile
    circularFontProfile: FontProfile
    rectangularStripColumnWidth: Positive
    circularStripRingWidth: Positive
    rectangularHeatmapColumnWidth: Positive
    circularHeatmapRingWidth: Positive
    showInternalNodes: bool
    showBranchGuides: bool
    showBranchLengths: bool
    circularArcDegrees: Annotated[float, Field(gt=0, le=360)]
    circularRotationDegrees: Finite

class Point(DocumentModel):
    x: Finite
    y: Finite

class Viewport(DocumentModel):
    width: Positive
    height: Positive

class Camera(DocumentModel):
    cameraSchemaVersion: Literal[3]
    interactionScale: Positive
    anchor: Point
    viewport: Viewport

class LegacyCamera(DocumentModel):
    zoom: Positive
    interactionZoom: Positive
    offset: Point
    viewport: Viewport
    autoFitZoom: Positive
    referenceFitZoom: Positive

class Cameras(DocumentModel):
    rectangular: Camera | LegacyCamera | None
    circular: Camera | LegacyCamera | None

class Legend(Viewport):
    open: bool
    x: Finite
    y: Finite

class Scroll(DocumentModel):
    left: Finite
    top: Finite

class View(DocumentModel):
    cameras: Cameras
    heatmapLegend: Legend | None
    taxonAnnotation: Legend | None
    drawerPanel: Literal["tree", "heatmap"]
    drawerOpen: bool
    controlDrawerWidth: Positive
    selectedNodeId: NodeId | None
    scroll: Scroll
    controlPanelScrollTop: Annotated[float, Field(ge=0)]

class NameDraftTarget(DocumentModel):
    nodeId: NodeId | None
    collapseRank: str | None

class HeatmapStyleDraft(DocumentModel):
    open: bool
    paletteId: str
    shape: Literal["fill", "circle", "triangle", "square"]
    name: str
    colorScales: ColorScales
    metric: Literal["count", "ratio"]
    editingId: str | None

class TreeStyleDraft(DocumentModel):
    open: bool
    nodeId: NodeId | None
    kind: Literal["label", "branch", "background", "strip"]
    color: str

class Drafts(DocumentModel):
    queryMode: Literal["manual", "batch"]
    conditions: list[dict[str, Any]]
    batchQueryText: str
    branchPruneDraft: dict[str, Any]
    treeSearch: str
    treeSearchRank: str
    treeSearchPickedItem: dict[str, Any] | None
    detailRankSearch: str
    detailRankSearchRank: str
    detailRankTargetRank: str
    heatmapQueryConditions: list[dict[str, Any]]
    heatmapBatchQueryText: str
    resultScopeSearch: str
    resultScopeSearchRank: str
    resultScopeExpandRank: str
    customNameDraft: str
    nameTarget: NameDraftTarget
    heatmapStyle: HeatmapStyleDraft
    treeStyle: TreeStyleDraft

class CanvasDocument(DocumentModel):
    schemaVersion: Literal[2, 3]
    rendererVersion: Literal[1, 2]
    dataset: Dataset
    tree: TreeDocument
    resetBaseline: TreeDocument | None
    query: Query
    cart: Cart
    treeStyles: list[TreeStyle]
    heatmap: Heatmap
    appearance: Appearance
    view: View
    drafts: Drafts

    @model_validator(mode="after")
    def validate_relationships(self):
        if (self.schemaVersion, self.rendererVersion) not in {(2, 1), (3, 2)}:
            raise ValueError("archive schema and renderer versions are incompatible")
        if self.query.resultSession.species_tree != self.dataset.speciesTree or self.query.resultSession.genome_database != self.dataset.genomeDatabase:
            raise ValueError("query and document datasets differ")
        if getattr(self.view.cameras, self.appearance.treeViewMode) is None:
            raise ValueError("missing active camera")
        threshold = float(self.heatmap.moduleCompletenessThreshold)
        if not 0 <= threshold <= 100:
            raise ValueError("invalid module threshold")
        columns = {column.column_id or f"{column.type}|{column.value}" for column in self.query.resultSession.columns}
        rows = {f"terminal-{row.nodeId}-{row.rank or 'node'}" for row in self.tree.terminalNodeTable}
        for style in self.heatmap.styles:
            for key in style.leafCellKeys:
                target, separator, column = key.partition("::")
                if not separator or not target.isascii() or not target.isdecimal() or column not in columns:
                    raise ValueError("invalid heatmap style target")
        for key in self.heatmap.selectedCellKeys:
            target, separator, column = key.partition("::")
            if not separator or target not in rows or column not in columns:
                raise ValueError("invalid heatmap selection")
        for styles in (self.treeStyles, self.heatmap.styles):
            if len({style.id for style in styles}) != len(styles):
                raise ValueError("duplicate style id")
        if len({record.id for record in self.cart.records}) != len(self.cart.records) or len({batch.id for batch in self.cart.batches}) != len(self.cart.batches):
            raise ValueError("duplicate Cart identity")
        batches = {batch.id for batch in self.cart.batches}
        if any(record.batchId not in batches for record in self.cart.records):
            raise ValueError("unknown Cart batch")
        return self
