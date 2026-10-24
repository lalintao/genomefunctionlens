import type { Language } from "./types";

type DrawerTab = "tree" | "heatmap" | "cart" | "chat";
type DrawerContentTab = Exclude<DrawerTab, "chat">;

export type DesignPreviewStoryBlock = {
  id: string;
  title: string;
  body: string;
  stat: string;
};

export type DesignPreviewDrawerSection = {
  id: string;
  title: string;
  lines: string[];
};

export type DesignPreviewCopy = {
  preview: string;
  languageLabel: string;
  heroKicker: string;
  heroTitle: string;
  heroDescription: string;
  paper: string;
  github: string;
  navHome: string;
  navQuery: string;
  navExamples: string;
  navAbout: string;
  homeBackground: string;
  querySectionTitle: string;
  queryPanelTitle: string;
  chatPanelTitle: string;
  manual: string;
  batch: string;
  datasetA: string;
  datasetB: string;
  search: string;
  manualPlaceholders: [string, string];
  ctaTitle: string;
  ctaAction: string;
  aboutTitle: string;
  githubLabel: string;
  emailLabel: string;
  workbenchBack: string;
  workbenchCanvas: string;
  drawerCollapse: string;
  drawerExpand: string;
  drawerTabs: Record<DrawerTab, string>;
  drawerHeads: Record<DrawerTab, string>;
  drawerSections: Record<DrawerContentTab, DesignPreviewDrawerSection[]>;
  storyBlocks: DesignPreviewStoryBlock[];
};

export const DESIGN_PREVIEW_TEXT: Record<Language, DesignPreviewCopy> = {
  zh: {
    preview: "设计预览",
    languageLabel: "语言切换",
    heroKicker: "Protein Phylogenetic Distribution",
    heroTitle: "蛋白质系统发育分布",
    heroDescription:
      "本系统适用于对可注释功能蛋白快速查询其在系统发育树上的分布情况，以及序列下载、高质量系统发育分布热图导出等功能。",
    paper: "阅读论文",
    github: "GitHub",
    navHome: "首页",
    navQuery: "查询",
    navExamples: "示例展示",
    navAbout: "关于我们",
    homeBackground: "首页背景 RGB",
    querySectionTitle: "开始使用 Protein Phylogenetic Distribution",
    queryPanelTitle: "手动入口",
    chatPanelTitle: "分析对话",
    manual: "手动查询",
    batch: "批量查询",
    datasetA: "GTDB r226",
    datasetB: "KEGG release",
    search: "开始搜索",
    manualPlaceholders: [
      "例如：COG0001 / methane metabolism",
      "例如：M00357 / methanogenesis",
    ],
    ctaTitle: "探索蛋白质系统发育分布",
    ctaAction: "开始查询",
    aboutTitle: "关于我们",
    githubLabel: "GitHub",
    emailLabel: "邮箱",
    workbenchBack: "返回首页预览",
    workbenchCanvas: "画布保持纯白，不在此处预览结果。",
    drawerCollapse: "收起   >>",
    drawerExpand: "<<   展开",
    drawerTabs: {
      tree: "物种树",
      heatmap: "热图",
      cart: "下载",
      chat: "Chat",
    },
    drawerHeads: {
      tree: "物种树控制",
      heatmap: "热图控制",
      cart: "下载控制",
      chat: "会话控制",
    },
    drawerSections: {
      tree: [
        {
          id: "tree-view",
          title: "树视图",
          lines: ["矩形 / 环形", "显示层级", "分支标签字号", "内部节点可见性"],
        },
        {
          id: "tree-search",
          title: "树搜索",
          lines: ["Taxon rank", "节点或 accession", "定位当前结果"],
        },
        {
          id: "tree-filter",
          title: "范围筛选",
          lines: ["仅 RefSeq", "完整度阈值", "污染度上限", "作用到当前范围"],
        },
      ],
      heatmap: [
        {
          id: "heatmap-columns",
          title: "列与标签",
          lines: ["列标签", "模块名称", "完整度阈值", "数值显示模式"],
        },
        {
          id: "heatmap-style",
          title: "视觉编码",
          lines: ["配色", "形状", "数值覆盖", "单元格尺寸"],
        },
      ],
      cart: [
        {
          id: "cart-add",
          title: "加入分支",
          lines: ["祖先层级", "内部节点搜索", "展开到层级", "加入可见子树"],
        },
        {
          id: "cart-export",
          title: "导出",
          lines: ["下载全部序列", "代表序列下载", "导出绘图数据", "导出 SVG", "导出 PNG", "导出 PDF"],
        },
      ],
    },
    storyBlocks: [
      {
        id: "atlas",
        title: "将功能命中映射到系统发育背景中",
        body: "这里后续可以替换为真实的系统发育树图、聚合热图或功能模块示意图，当前先保留图像优先的叙事节奏。",
        stat: "Annotation x phylogeny",
      },
      {
        id: "density",
        title: "在不同 taxon rank 之间切换分布密度视角",
        body: "这一组适合展示门、纲、目等不同层级的统计对比，也适合承接后续完整度、富集与分支对照图像。",
        stat: "Rank-aware distribution",
      },
      {
        id: "workflow",
        title: "把查询、筛选与导出组织成连续研究流程",
        body: "页面语气应更像科研工具而不是产品宣传，让查询、物种树、热图与序列下载在同一工作流里自然衔接。",
        stat: "Query to export",
      },
    ],
  },
  en: {
    preview: "Design Preview",
    languageLabel: "Language",
    heroKicker: "Protein Phylogenetic Distribution",
    heroTitle: "Protein Phylogenetic Distribution",
    heroDescription:
      "This system supports rapid querying of annotated functional proteins across phylogenetic trees, sequence download, and export of high-quality phylogenetic distribution heatmaps.",
    paper: "Read Paper",
    github: "GitHub",
    navHome: "Home",
    navQuery: "Query",
    navExamples: "Examples",
    navAbout: "About",
    homeBackground: "Home Background RGB",
    querySectionTitle: "Start with Protein Phylogenetic Distribution",
    queryPanelTitle: "Manual Entry",
    chatPanelTitle: "Analysis chat",
    manual: "Manual",
    batch: "Batch",
    datasetA: "GTDB r226",
    datasetB: "KEGG release",
    search: "Start Search",
    manualPlaceholders: [
      "Example: COG0001 / methane metabolism",
      "Example: M00357 / methanogenesis",
    ],
    ctaTitle: "Explore protein phylogenetic distribution",
    ctaAction: "Start Query",
    aboutTitle: "About",
    githubLabel: "GitHub",
    emailLabel: "Email",
    workbenchBack: "Back to Landing",
    workbenchCanvas: "Canvas stays pure white and does not preview results here.",
    drawerCollapse: "Collapse   >>",
    drawerExpand: "<<   Open",
    drawerTabs: {
      tree: "Tree",
      heatmap: "Heatmap",
      cart: "Download",
      chat: "Chat",
    },
    drawerHeads: {
      tree: "Species tree controls",
      heatmap: "Heatmap controls",
      cart: "Download controls",
      chat: "Chat controls",
    },
    drawerSections: {
      tree: [
        {
          id: "tree-view",
          title: "Tree View",
          lines: ["Rectangular / Circular", "Display rank", "Branch label size", "Internal node visibility"],
        },
        {
          id: "tree-search",
          title: "Tree Search",
          lines: ["Search scope", "Taxon rank", "Node or accession", "Focus current result"],
        },
        {
          id: "tree-filter",
          title: "Scope Filter",
          lines: ["RefSeq only", "Completeness threshold", "Contamination limit", "Apply to active scope"],
        },
      ],
      heatmap: [
        {
          id: "heatmap-columns",
          title: "Columns and Labels",
          lines: ["Column labels", "Module names", "Completeness threshold", "Value display mode"],
        },
        {
          id: "heatmap-style",
          title: "Visual Encoding",
          lines: ["Palette", "Shape", "Numeric overlay", "Cell size"],
        },
      ],
      cart: [
        {
          id: "cart-add",
          title: "Add Branches",
          lines: ["Ancestor rank", "Internal node search", "Expand to rank", "Add visible subtree"],
        },
        {
          id: "cart-export",
          title: "Export",
          lines: ["Download all sequences", "Representative sequences", "Export plot data", "Export SVG", "Export PNG", "Export PDF"],
        },
      ],
    },
    storyBlocks: [
      {
        id: "atlas",
        title: "Map functional hits onto a phylogenetic background",
        body: "This block can later hold a real phylogenetic tree, aggregated heatmap, or module schematic while already establishing an image-first narrative rhythm.",
        stat: "Annotation x phylogeny",
      },
      {
        id: "density",
        title: "Shift distribution density across taxonomic ranks",
        body: "This layout suits comparisons across phylum, class, or order and can later hold completeness, enrichment, or branch-comparison visuals.",
        stat: "Rank-aware distribution",
      },
      {
        id: "workflow",
        title: "Organize query, filtering, and export into one research flow",
        body: "The page should behave like a research instrument rather than a product pitch, linking query, tree, heatmap, and sequence export into one workflow.",
        stat: "Query to export",
      },
    ],
  },
};
