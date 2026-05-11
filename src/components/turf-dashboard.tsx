"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type {
  CircleMarkerOptions,
  GeoJSON as LeafletGeoJSON,
  Layer as LeafletLayer,
  LayerGroup,
  Map as LeafletMap,
  PathOptions,
  Polygon,
} from "leaflet";
import {
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Clipboard,
  Download,
  MousePointer2,
  Layers,
  Loader2,
  MapPinned,
  Navigation,
  Pencil,
  Radio,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type TurfRow = Record<string, string>;

type ColumnStats = {
  average: number;
  min: number;
  max: number;
};

type PredictionLocation = {
  lat: number;
  lon: number;
  label: string;
};

type PlannerRecommendation = {
  row: TurfRow;
  rank: number;
  score: number;
  distance?: number;
  action: "Canvass now" | "Scout access first" | "Mail/digital follow-up" | "Skip today";
  rationale: string[];
  messaging: string;
};

type CanvassDecision = "Go" | "Scout" | "Skip";

type CanvassSummary = {
  decision: CanvassDecision;
  decisionReason: string;
  turfCount: number;
  households: number;
  donors: number;
  revenue: number;
  averageRoi: number;
  doorAccess: number;
  missionAlignment: number;
  oppositionRisk: number;
  avoidPressure: number;
  dataConfidence: number;
  strongestTarget: { label: string; score: number };
  strongestAvoid: { label: string; score: number };
};

type CanvassArea = {
  location: PredictionLocation;
  radiusMiles: number;
  usedFallback: boolean;
  recommendations: PlannerRecommendation[];
  summary: CanvassSummary;
};

type GeoJsonFeature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: GeoJSON.Geometry;
};

type GeoJsonCollection = {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
};

type ParcelTileManifest = {
  tile_zoom: number;
  min_display_zoom: number;
  feature_count: number;
  tile_count: number;
  housing_types: Record<string, { label: string; color: string }>;
};

type TurfPoint = {
  lat: number;
  lon: number;
};

type DrawnTurf = {
  id: string;
  name: string;
  points: TurfPoint[];
  createdAt: string;
};

type DrawnTurfStats = {
  blockGroups: number;
  households: number;
  donors: number;
  revenue: number;
  averagePriority: number;
  missionAlignment: number;
  doorAccess: number;
  avoidPressure: number;
  oppositionRisk: number;
  dataConfidence: number;
  demographics: Array<{ label: string; value: string }>;
  housingCounts: Record<string, number>;
  housingTotal: number;
  loadingHousing: boolean;
  tooLargeForParcels: boolean;
};

type MapLayerDefinition = {
  group: string;
  field: string;
  label: string;
  description: string;
  format: "score" | "number" | "money" | "percent" | "text";
  palette: keyof typeof mapPalettes;
};

type MapPreset = {
  label: string;
  layer: string;
  description: string;
  test: (properties: Record<string, unknown>) => boolean;
};

type MapGeographyPreset = {
  label: string;
  counties: string[];
  municipalities: string[];
};

type SavedState = Partial<{
  search: string;
  displaySearch: string;
  counties: string[];
  municipalities: string[];
  tiers: string[];
  minScore: string;
  sortColumn: string;
  sortDirection: "asc" | "desc";
  columnPreset: string;
  comparisonMode: boolean;
  tableView: string;
}>;

const csvPath = "/data/scored_turfs_ma_bg_plus_ma_elections.csv";
const mapGeojsonPath = "/data/ma_block_groups_scored.geojson";
const municipalGeojsonPath = "/data/ma_municipalities.geojson";
const parcelTileManifestPath = "/data/parcel-tiles/manifest.json";
const defaultParcelTileZoom = 14;
const defaultParcelMinZoom = 14;
const fallbackParcelHousingTypes: ParcelTileManifest["housing_types"] = {
  single_family: { label: "Single-family", color: "#287c71" },
  condo_1_unit_or_unknown: { label: "Condo, 1 unit/unknown", color: "#8aa0ff" },
  condo_2_unit_building: { label: "Condo, 2-unit building", color: "#6d7df0" },
  condo_3_4_unit_building: { label: "Condo, 3-4 unit building", color: "#5b5bd6" },
  condo_5_9_unit_building: { label: "Condo, 5-9 unit building", color: "#4640b8" },
  condo_10_plus_building: { label: "Condo, 10+ unit building", color: "#332a86" },
  two_family: { label: "Two-family", color: "#df9b2f" },
  three_family: { label: "Three-family", color: "#d66a3a" },
  small_multifamily: { label: "Small multifamily", color: "#c2477f" },
  large_multifamily: { label: "Large multifamily", color: "#7c3bb6" },
  residential_land_or_aux: { label: "Residential land/aux", color: "#98a2b3" },
  residential_other: { label: "Residential other", color: "#667085" },
};
const storageKey = "gbhTurfExplorerState:v1";
const drawnTurfStorageKey = "gbhCustomTurfs:v1";
const pageSize = 100;
const maxTurfParcelTiles = 80;

const importantColumns = [
  "GIDBG",
  "display_location",
  "County_name",
  "municipality_name",
  "overall_score",
  "election_adjusted_score",
  "overall_tier",
  "election_adjusted_tier",
  "recommended_outreach_channel",
  "mission_alignment_index",
  "estimated_donors",
  "estimated_revenue",
  "total_population",
];

const columnPresets: Record<string, string[]> = {
  overview: importantColumns,
  planner: [
    "GIDBG",
    "display_location",
    "municipality_name",
    "map_priority_index",
    "overall_score",
    "door_access_index",
    "mission_alignment_index",
    "estimated_canvassable_households",
    "estimated_donors",
    "estimated_revenue",
    "avoid_pressure_index",
    "data_confidence_index",
    "recommended_outreach_channel",
  ],
  scores: [
    "GIDBG",
    "display_location",
    "overall_score",
    "election_adjusted_score",
    "map_priority_index",
    "target_presence_index",
    "mission_alignment_index",
    "opposition_risk_index",
    "avoid_pressure_index",
    "data_confidence_index",
  ],
  targets: [
    "GIDBG",
    "display_location",
    "target_affluent_educated_older_index",
    "target_major_donor_index",
    "target_professional_family_index",
    "target_young_urban_professional_index",
  ],
  avoids: [
    "GIDBG",
    "display_location",
    "avoid_economic_stress_index",
    "avoid_transient_renter_index",
    "avoid_pressure_index",
  ],
  political: [
    "GIDBG",
    "display_location",
    "democratic_presence_index",
    "mission_alignment_index",
    "opposition_risk_index",
    "republican_presence_index",
    "unenrolled_pool_index",
    "raw_ma_registered_voters",
    "raw_ma_unenrolled_count",
    "raw_ma_unenrolled_share",
  ],
  raw: [
    "GIDBG",
    "display_location",
    "total_population",
    "median_household_income",
    "median_home_value",
    "bachelors_or_higher_pct",
    "occupied_household_density",
    "location_latitude",
    "location_longitude",
  ],
  assumptions: [
    "GIDBG",
    "display_location",
    "estimated_donors",
    "estimated_revenue",
    "recommended_outreach_channel",
    "data_confidence_index",
  ],
};

const municipalityBaseColumns = [
  "municipality_name",
  "County_name",
  "turf_count",
  "average_score",
  "median_score",
  "estimated_donors",
  "estimated_revenue",
  "total_population",
];

const sumColumns = new Set([
  "estimated_donors",
  "estimated_revenue",
  "total_population",
  "raw_ma_registered_voters",
  "raw_ma_unenrolled_count",
]);

const moneyColumns = new Set([
  "estimated_revenue",
  "median_household_income",
  "median_home_value",
]);

const percentColumns = new Set(
  [
    "pct",
    "percent",
    "share",
    "rate",
    "turnout",
    "_pct",
  ],
);

const mapPalettes = {
  score: ["#f2f2f2", "#edd4f5", "#b870d6", "#732487", "#361247"],
  target: ["#f7f3fb", "#c1afc9", "#ad40d9", "#732487", "#361247"],
  access: ["#fffbe6", "#fcf273", "#f5de00", "#ffc21b", "#732487"],
  stability: ["#f2f2f2", "#dadada", "#a2a2a2", "#676767", "#373737"],
  avoid: ["#fff0f4", "#f6a3bf", "#ea0051", "#d9004b", "#bf0f0f"],
  neutral: ["#ffffff", "#dadada", "#a2a2a2", "#676767", "#373737"],
};

const mapLayerCatalog: MapLayerDefinition[] = [
  { group: "Priority", field: "overall_score", label: "Overall ROI", description: "Primary fundraising ROI score.", format: "score", palette: "score" },
  { group: "Priority", field: "election_adjusted_score", label: "Election Adjusted", description: "Election-aware version of the ROI score.", format: "score", palette: "score" },
  { group: "Priority", field: "map_priority_index", label: "Field Priority", description: "Door-deployment priority for field teams.", format: "score", palette: "score" },
  { group: "Target", field: "target_presence_index", label: "Target Presence", description: "Combined strength of target profiles.", format: "score", palette: "target" },
  { group: "Target", field: "target_affluent_educated_older_index", label: "A Affluent Older", description: "Affluent, educated, older target profile.", format: "score", palette: "target" },
  { group: "Target", field: "target_major_donor_index", label: "B Major Donor", description: "Major donor profile.", format: "score", palette: "target" },
  { group: "Target", field: "target_professional_family_index", label: "C Professional Family", description: "Professional family profile.", format: "score", palette: "target" },
  { group: "Target", field: "target_young_urban_professional_index", label: "D Young Urban", description: "Young urban professional profile.", format: "score", palette: "target" },
  { group: "Alignment", field: "mission_alignment_index", label: "Mission Fit", description: "Aggregate left-leaning, college-educated, civically engaged mission-fit signal.", format: "score", palette: "target" },
  { group: "Alignment", field: "opposition_risk_index", label: "Opposition Risk", description: "Aggregate opposition-risk signal from Republican enrollment and activity.", format: "score", palette: "avoid" },
  { group: "Avoid", field: "avoid_pressure_index", label: "Avoid Pressure", description: "Combined pressure from avoid profiles.", format: "score", palette: "avoid" },
  { group: "Avoid", field: "avoid_economic_stress_index", label: "Economic Stress", description: "Economic-stress avoid profile.", format: "score", palette: "avoid" },
  { group: "Avoid", field: "avoid_transient_renter_index", label: "Transient Renters", description: "Transient renter avoid profile.", format: "score", palette: "avoid" },
  { group: "Election", field: "democratic_presence_index", label: "Democratic Presence", description: "Democratic vote/enrollment signal.", format: "score", palette: "target" },
  { group: "Election", field: "republican_presence_index", label: "Republican Presence", description: "Republican vote/enrollment signal.", format: "score", palette: "avoid" },
  { group: "Election", field: "unenrolled_pool_index", label: "Unenrolled Pool", description: "Unenrolled voter opportunity.", format: "score", palette: "access" },
  { group: "Data", field: "data_confidence_index", label: "Data Confidence", description: "Confidence in the available local data.", format: "score", palette: "stability" },
  { group: "Assumptions", field: "estimated_donors", label: "Estimated Donors", description: "Estimated donor count.", format: "number", palette: "score" },
  { group: "Assumptions", field: "estimated_revenue", label: "Estimated Revenue", description: "Estimated revenue.", format: "money", palette: "score" },
  { group: "Population", field: "total_population", label: "Population", description: "Total population.", format: "number", palette: "neutral" },
];

const mapPresetDefinitions: Record<string, MapPreset> = {
  overall_roi: { label: "Overall ROI", layer: "overall_score", description: "Top-scoring overall ROI areas.", test: p => number(p.overall_score) >= 75 },
  target_fit: { label: "Target Fit", layer: "target_presence_index", description: "Strong target-profile fit.", test: p => number(p.target_presence_index) >= 70 },
  target_affluent_educated_older: { label: "A Affluent Older", layer: "target_affluent_educated_older_index", description: "Strong A profile areas.", test: p => number(p.target_affluent_educated_older_index) >= 70 },
  target_major_donor: { label: "B Major Donor", layer: "target_major_donor_index", description: "Strong B profile areas.", test: p => number(p.target_major_donor_index) >= 70 },
  target_professional_family: { label: "C Professional Family", layer: "target_professional_family_index", description: "Strong C profile areas.", test: p => number(p.target_professional_family_index) >= 70 },
  target_young_urban_professional: { label: "D Young Urban", layer: "target_young_urban_professional_index", description: "Strong D profile areas.", test: p => number(p.target_young_urban_professional_index) >= 70 },
  mission_alignment: { label: "Mission Fit", layer: "mission_alignment_index", description: "Strong public-media mission fit.", test: p => number(p.mission_alignment_index) >= 70 },
  opposition_risk: { label: "Opposition Risk", layer: "opposition_risk_index", description: "Higher opposition-risk areas.", test: p => number(p.opposition_risk_index) >= 70 },
  avoid_economic_stress: { label: "Avoid Economic Stress", layer: "avoid_economic_stress_index", description: "High economic stress pressure.", test: p => number(p.avoid_economic_stress_index) >= 70 },
  avoid_transient_renters: { label: "Avoid Transient Renters", layer: "avoid_transient_renter_index", description: "High transient renter pressure.", test: p => number(p.avoid_transient_renter_index) >= 70 },
  democratic_presence: { label: "Democratic Presence", layer: "democratic_presence_index", description: "High Democratic presence.", test: p => number(p.democratic_presence_index) >= 70 },
  republican_presence: { label: "Republican Presence", layer: "republican_presence_index", description: "High Republican presence.", test: p => number(p.republican_presence_index) >= 70 },
  unenrolled_pool: { label: "Unenrolled Pool", layer: "unenrolled_pool_index", description: "High unenrolled pool.", test: p => number(p.unenrolled_pool_index) >= 70 },
  data_gaps: { label: "Data Gaps", layer: "data_confidence_index", description: "Lower-confidence areas to inspect.", test: p => number(p.data_confidence_index) < 50 },
};

const mapGeographyPresetDefinitions: Record<string, MapGeographyPreset> = {
  greater_boston: {
    label: "Greater Boston",
    counties: ["Suffolk County", "Middlesex County", "Norfolk County"],
    municipalities: ["Boston", "Brookline", "Cambridge", "Chelsea", "Everett", "Malden", "Medford", "Melrose", "Newton", "Quincy", "Revere", "Somerville", "Watertown", "Winthrop"],
  },
  metro_core: {
    label: "Metro Core",
    counties: [],
    municipalities: ["Boston", "Brookline", "Cambridge", "Chelsea", "Everett", "Malden", "Medford", "Newton", "Somerville", "Watertown"],
  },
  north_shore: {
    label: "North Shore",
    counties: ["Essex County"],
    municipalities: ["Beverly", "Gloucester", "Ipswich", "Lynn", "Manchester-by-the-Sea", "Marblehead", "Nahant", "Peabody", "Rockport", "Salem", "Saugus", "Swampscott"],
  },
  south_shore: {
    label: "South Shore",
    counties: ["Plymouth County", "Norfolk County"],
    municipalities: ["Braintree", "Cohasset", "Duxbury", "Hanover", "Hingham", "Hull", "Marshfield", "Milton", "Norwell", "Quincy", "Scituate", "Weymouth"],
  },
  metro_west: {
    label: "MetroWest",
    counties: ["Middlesex County", "Norfolk County", "Worcester County"],
    municipalities: ["Acton", "Ashland", "Concord", "Framingham", "Hopkinton", "Lexington", "Lincoln", "Natick", "Needham", "Sherborn", "Sudbury", "Wayland", "Wellesley", "Weston"],
  },
  cape_islands: { label: "Cape & Islands", counties: ["Barnstable County", "Dukes County", "Nantucket County"], municipalities: [] },
  western_ma: { label: "Western MA", counties: ["Berkshire County", "Franklin County", "Hampden County", "Hampshire County"], municipalities: [] },
};

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function TurfDashboard() {
  const savedState = useMemo(() => readSavedState(), []);
  const [rows, setRows] = useState<TurfRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [numericColumns, setNumericColumns] = useState<Set<string>>(new Set());
  const [columnStats, setColumnStats] = useState<Map<string, ColumnStats>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState(savedState.search ?? "");
  const [displaySearch, setDisplaySearch] = useState(savedState.displaySearch ?? "");
  const [counties, setCounties] = useState<string[]>(savedState.counties ?? []);
  const [municipalities, setMunicipalities] = useState<string[]>(savedState.municipalities ?? []);
  const [tiers, setTiers] = useState<string[]>(savedState.tiers ?? []);
  const [minScore, setMinScore] = useState(savedState.minScore ?? "");
  const [sortColumn, setSortColumn] = useState(savedState.sortColumn ?? "election_adjusted_score");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">(savedState.sortDirection ?? "desc");
  const [columnPreset, setColumnPreset] = useState(savedState.columnPreset ?? "overview");
  const [comparisonMode, setComparisonMode] = useState(Boolean(savedState.comparisonMode));
  const [tableView, setTableView] = useState(savedState.tableView ?? "turfs");
  const [page, setPage] = useState(1);
  const [expandedKey, setExpandedKey] = useState("");

  useEffect(() => {
    fetch(csvPath)
      .then(response => {
        if (!response.ok) throw new Error(`CSV request failed: ${response.status}`);
        return response.text();
      })
      .then(text => {
        const parsed = parseCsv(text.trim());
        const [head = [], ...body] = parsed;
        const nextRows = body.map(values => Object.fromEntries(head.map((header, index) => [header, values[index] ?? ""])));
        const nextNumeric = detectNumericColumns(head, nextRows);
        setHeaders(head);
        setRows(nextRows);
        setNumericColumns(nextNumeric);
        setColumnStats(computeColumnStats(head, nextRows, nextNumeric));
        setLoading(false);
      })
      .catch(error => {
        setLoadError(error instanceof Error ? error.message : "Unable to load CSV.");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!rows.length) return;
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        search,
        displaySearch,
        counties,
        municipalities,
        tiers,
        minScore,
        sortColumn,
        sortDirection,
        columnPreset,
        comparisonMode,
        tableView,
      }),
    );
  }, [columnPreset, comparisonMode, counties, displaySearch, minScore, municipalities, rows.length, search, sortColumn, sortDirection, tableView, tiers]);

  const primaryScoreCol = useMemo(() => primaryScoreColumn(headers), [headers]);
  const tierColumn = useMemo(() => primaryTierColumn(headers), [headers]);

  const filterOptions = useMemo(() => ({
    counties: unique(rows.map(row => row.County_name)),
    municipalities: unique(rows.map(row => row.municipality_name)),
    tiers: unique(rows.map(row => row[tierColumn])),
  }), [rows, tierColumn]);

  const visibleColumns = useMemo(() => {
    if (columnPreset === "all") return headers;
    return (columnPresets[columnPreset] ?? importantColumns).filter(column => headers.includes(column));
  }, [columnPreset, headers]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const displayTerm = displaySearch.trim().toLowerCase();
    const countySet = new Set(counties);
    const municipalitySet = new Set(municipalities);
    const tierSet = new Set(tiers);
    const min = Number(minScore || 0);
    return rows.filter(row => {
      const matchesTerm = !term || Object.values(row).some(value => String(value).toLowerCase().includes(term));
      const matchesDisplay = !displayTerm || String(row.display_location || "").toLowerCase().includes(displayTerm);
      const matchesCounty = !countySet.size || countySet.has(row.County_name);
      const matchesMunicipality = !municipalitySet.size || municipalitySet.has(row.municipality_name);
      const matchesTier = !tierSet.size || tierSet.has(row[tierColumn]);
      const matchesScore = primaryScore(row, primaryScoreCol) >= min;
      return matchesTerm && matchesDisplay && matchesCounty && matchesMunicipality && matchesTier && matchesScore;
    });
  }, [counties, displaySearch, minScore, municipalities, primaryScoreCol, rows, search, tierColumn, tiers]);

  const tableRows = useMemo(() => {
    const source = tableView === "municipalities"
      ? aggregateMunicipalities(filteredRows, headers, primaryScoreCol)
      : [...filteredRows];
    const fallbackSort = source.some(row => row[sortColumn] !== undefined) ? sortColumn : primaryScoreCol;
    return source.sort((a, b) => {
      const aValue = a[fallbackSort] ?? "";
      const bValue = b[fallbackSort] ?? "";
      const result = numericColumns.has(fallbackSort) || fallbackSort === "average_score" || fallbackSort === "median_score" || fallbackSort === "turf_count"
        ? number(aValue) - number(bValue)
        : String(aValue).localeCompare(String(bValue));
      return sortDirection === "asc" ? result : -result;
    });
  }, [filteredRows, headers, numericColumns, primaryScoreCol, sortColumn, sortDirection, tableView]);

  const currentColumns = tableView === "municipalities"
    ? municipalityBaseColumns.filter(column => tableRows.some(row => row[column] !== undefined))
    : visibleColumns;
  const totalPages = Math.max(1, Math.ceil(tableRows.length / pageSize));
  const pageRows = tableRows.slice((Math.min(page, totalPages) - 1) * pageSize, Math.min(page, totalPages) * pageSize);

  const summary = useMemo(() => {
    const totalScore = filteredRows.reduce((sum, row) => sum + primaryScore(row, primaryScoreCol), 0);
    return {
      rows: rows.length,
      visible: filteredRows.length,
      average: filteredRows.length ? totalScore / filteredRows.length : 0,
      revenue: filteredRows.reduce((sum, row) => sum + number(row.estimated_revenue), 0),
      donors: filteredRows.reduce((sum, row) => sum + number(row.estimated_donors), 0),
      population: filteredRows.reduce((sum, row) => sum + number(row.total_population), 0),
    };
  }, [filteredRows, primaryScoreCol, rows.length]);

  function resetFilters() {
    setSearch("");
    setDisplaySearch("");
    setCounties([]);
    setMunicipalities([]);
    setTiers([]);
    setMinScore("");
    setComparisonMode(false);
    setSortColumn(primaryScoreCol);
    setSortDirection("desc");
    localStorage.removeItem(storageKey);
  }

  return (
    <main className="min-h-screen bg-[#f2f2f2]">
      <header className="bg-[#4f1c59] text-white">
        <div className="mx-auto flex max-w-[1800px] items-center gap-5 px-5 py-3 md:px-12">
          <div className="flex items-center gap-5">
            <GbhLogo className="h-16 w-[126px] text-white" />
            <span className="hidden text-xl font-extrabold tracking-[-0.02em] md:inline">What matters to you.</span>
          </div>
        </div>
        <div className="h-4 bg-[#361247]/35 [clip-path:polygon(0_0,24%_0,26%_100%,100%_100%,100%_0)]" />
      </header>

      <section className="bg-[#361247] text-white">
        <div className="mx-auto grid max-w-[1800px] gap-6 px-5 py-8 md:grid-cols-[1fr_420px] md:px-12">
          <div>
            <div className="mb-4 flex items-center gap-3">
              <Badge className="bg-[#d90000] text-white"><Radio data-icon="inline-start" />Live data</Badge>
              <span className="font-bold text-[#c1afc9]">{loading ? "Loading scored Massachusetts block groups" : `${whole.format(rows.length)} turfs loaded`}</span>
            </div>
            <h1 className="max-w-4xl text-5xl font-black leading-[0.95] tracking-[-0.04em] md:text-7xl">GBH Canvass Map</h1>
            <p className="mt-4 max-w-3xl text-xl font-medium leading-8 text-[#edd4f5]">Enter an address, tune the radius, and make the field decision from the map, house dots, ranked zones, and local stats in one place.</p>
          </div>
          <div className="rounded-none bg-[#5b1f68] p-7 shadow-2xl">
            <h2 className="text-3xl font-black leading-tight">Built for today&apos;s route call.</h2>
            <p className="mt-3 text-lg leading-7 text-[#edd4f5]">The default view now answers whether a crew should canvass, scout, or skip a local area before anyone hits the street.</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1800px] px-5 pt-6 md:px-12">
        <TurfMap rows={rows} rowsLoading={loading} primaryScoreCol={primaryScoreCol} />
      </section>

      <Tabs defaultValue="details" className="mx-auto flex max-w-[1800px] flex-col gap-5 px-5 py-6 md:px-12">
        <TabsList className="w-fit bg-white">
          <TabsTrigger value="details"><MapPinned data-icon="inline-start" />Details</TabsTrigger>
          <TabsTrigger value="scores"><BarChart3 data-icon="inline-start" />Score Distribution</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="flex flex-col gap-4">
          <SummaryGrid summary={summary} loading={loading} />
          <Card>
            <CardHeader>
              <CardTitle>All Rows</CardTitle>
              <CardDescription>Use the detailed explorer when you need to audit or compare the underlying block-group data.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-[1.25fr_1fr_repeat(3,minmax(160px,0.8fr))_120px_180px_160px_auto]">
              <LabeledControl label="Search">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                  <Input value={search} onChange={event => { setSearch(event.target.value); setPage(1); setExpandedKey(""); }} className="pl-8" placeholder="Town, county, tract, GEO ID..." />
                </div>
              </LabeledControl>
              <LabeledControl label="Display location">
                <Input value={displaySearch} onChange={event => { setDisplaySearch(event.target.value); setPage(1); setExpandedKey(""); }} placeholder="Plain text location..." />
              </LabeledControl>
              <MultiSelect label="County" values={filterOptions.counties} selected={counties} onSelectedChange={next => { setCounties(next); setPage(1); setExpandedKey(""); }} emptyLabel="All counties" />
              <MultiSelect label="Municipality" values={filterOptions.municipalities} selected={municipalities} onSelectedChange={next => { setMunicipalities(next); setPage(1); setExpandedKey(""); }} emptyLabel="All municipalities" />
              <MultiSelect label="Tier" values={filterOptions.tiers} selected={tiers} onSelectedChange={next => { setTiers(next); setPage(1); setExpandedKey(""); }} emptyLabel="All tiers" />
              <LabeledControl label="Min score">
                <Input type="number" inputMode="decimal" min="0" max="100" step="0.1" value={minScore} onChange={event => { setMinScore(event.target.value); setPage(1); setExpandedKey(""); }} placeholder="0" />
              </LabeledControl>
              <LabeledControl label="Sort">
                <Select value={sortColumn} onValueChange={value => {
                  if (!value) return;
                  setSortColumn(value);
                  setSortDirection(numericColumns.has(value) ? "desc" : "asc");
                }}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {headers.map(header => <SelectItem key={header} value={header}>{labelize(header)}</SelectItem>)}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </LabeledControl>
              <LabeledControl label="Columns">
                <Select value={columnPreset} onValueChange={value => { if (value) { setColumnPreset(value); setPage(1); setExpandedKey(""); } }}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="overview">Overview</SelectItem>
                      <SelectItem value="planner">Recommended zones</SelectItem>
                      <SelectItem value="scores">Scores</SelectItem>
                      <SelectItem value="targets">Targets</SelectItem>
                      <SelectItem value="avoids">Avoids</SelectItem>
                      <SelectItem value="political">Political Presence</SelectItem>
                      <SelectItem value="raw">Raw data</SelectItem>
                      <SelectItem value="assumptions">Assumptions</SelectItem>
                      <SelectItem value="all">All columns</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </LabeledControl>
              <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3 2xl:col-span-1">
                <div className="flex h-9 items-center gap-2 border border-border px-3">
                  <Switch checked={comparisonMode} onCheckedChange={checked => { setComparisonMode(checked); setPage(1); setExpandedKey(""); }} />
                  <span className="text-sm font-medium">Compare</span>
                </div>
                <Button type="button" variant="outline" onClick={resetFilters} aria-label="Reset filters">
                  <RotateCcw data-icon="inline-start" />Reset
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>{tableView === "municipalities" ? "Municipalities" : "Turfs"}</CardTitle>
                <CardDescription>{tableView === "municipalities" ? "Aggregated from the filtered block groups." : "Browse individual block-group turfs."}</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Tabs value={tableView} onValueChange={value => { setTableView(value); setPage(1); setExpandedKey(""); }}>
                  <TabsList>
                    <TabsTrigger value="turfs">All Turfs</TabsTrigger>
                    <TabsTrigger value="municipalities">Municipalities</TabsTrigger>
                  </TabsList>
                </Tabs>
                <div className="flex items-center gap-2 border border-border px-2 py-1">
                  <Button variant="ghost" size="icon" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))} aria-label="Previous page">
                    <ChevronLeft />
                  </Button>
                  <span className="min-w-28 text-center text-sm text-muted-foreground">Page {Math.min(page, totalPages)} of {totalPages}</span>
                  <Button variant="ghost" size="icon" disabled={page >= totalPages} onClick={() => setPage(value => Math.min(totalPages, value + 1))} aria-label="Next page">
                    <ChevronRight />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loadError ? (
                <p className="rounded-none border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{loadError}</p>
              ) : loading ? (
                <div className="flex flex-col gap-2">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-10 w-full" />)}</div>
              ) : (
                <DataTable
                  rows={pageRows}
                  columns={currentColumns}
                  allRows={tableRows}
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  setSortColumn={setSortColumn}
                  setSortDirection={setSortDirection}
                  numericColumns={numericColumns}
                  columnStats={columnStats}
                  comparisonMode={comparisonMode}
                  expandedKey={expandedKey}
                  setExpandedKey={setExpandedKey}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="scores">
          <ScoreChart rows={filteredRows} primaryScoreCol={primaryScoreCol} />
        </TabsContent>
      </Tabs>
    </main>
  );
}

function GbhLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 110 57.9" aria-hidden="true">
      <g fill="currentColor" fillRule="evenodd">
        <path d="M43,24.2v-8.1l-6.7,6.1c-1.7-2-4.2-3.1-6.8-2.9c-5.4,0-9.1,4.2-9.1,9.6c0,5.8,3.7,9.6,9.2,9.6 c3.4,0,6.5-1.8,7.2-4.9h-9.3v-9.4H43z" />
        <path d="M89.2,33.6h-8.3v14.1H70.5v-6c-2.1,4.2-7,6-14.1,6H43v-5.3c-3.4,3.7-8.1,5.8-13.1,5.8 C17.1,48.2,10,39.4,10,28.9c-0.1-4.2,1.2-8.3,3.6-11.7L7,23.4C2,27.9,0,32.3,0,38.6C0,49,7.1,57.9,19.8,57.9c4.5,0,8.9-1.7,12.2-4.8 l0.5-0.4v4.8h13.4c5.4,0,9.6-1.1,12.1-3.5l2-1.8v5.3h11.6l5.9-5.4v5.4H89l10.5-9.7H89.2V33.6z" />
        <path d="M52.8,38.9h4.4c2.8,0,3.8-1.4,3.8-3.1c0-1.7-0.9-2.9-3.5-2.9h-4.6V38.9z" />
        <path d="M98.3,0.5l-5.7,5.3V0.5H80.9L78,3.2c-2.3-1.8-5.9-2.7-10.8-2.7H53.5l-2.4,2.3C47.8,0.9,44.1-0.1,40.4,0 c-5.1-0.1-10,1.8-13.7,5.2l-8,7.4c3.2-1.9,6.9-2.9,10.7-2.9c5-0.1,9.8,1.6,13.6,4.9v-4.4h13.7c8.2,0,12.6,2.5,13.8,7.6v-7.6h10.3V24 h8.3V10.2h10.4v37.5L110,38V0.5H98.3z" />
        <path d="M60.7,21.6c0-1.4-1.1-2.6-2.6-2.7c-0.1,0-0.2,0-0.4,0h-4.9v5.7h5c1.6,0,2.8-1.3,2.8-2.9 C60.7,21.7,60.7,21.6,60.7,21.6z" />
        <path d="M70.5,31.8V23c-0.5,2.1-1.8,4-3.6,5.4C68.4,29.2,69.6,30.4,70.5,31.8z" />
      </g>
    </svg>
  );
}

function SummaryGrid({ summary, loading }: { summary: { rows: number; visible: number; average: number; revenue: number; donors: number; population: number }; loading: boolean }) {
  const items = [
    ["Rows", whole.format(summary.rows)],
    ["Visible", whole.format(summary.visible)],
    ["Avg Score", nf.format(summary.average)],
    ["Est. Revenue", money.format(summary.revenue)],
    ["Est. Donors", whole.format(summary.donors)],
    ["Population", whole.format(summary.population)],
  ];
  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {items.map(([label, value]) => (
        <Card key={label} className="bg-white">
          <CardContent className="flex flex-col gap-1 p-4">
            <span className="text-xs font-black uppercase tracking-wide text-primary">{label}</span>
            {loading ? <Skeleton className="h-8 w-28" /> : <strong className="truncate text-3xl font-black leading-none text-[#361247]">{value}</strong>}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

function LabeledControl({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-black uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function MultiSelect({ label, values, selected, onSelectedChange, emptyLabel }: {
  label: string;
  values: string[];
  selected: string[];
  onSelectedChange: (next: string[]) => void;
  emptyLabel: string;
}) {
  const selectedSet = new Set(selected);
  const buttonLabel = selected.length === 0 ? emptyLabel : selected.length === 1 ? selected[0] : `${selected.length} selected`;
  return (
    <LabeledControl label={label}>
      <Popover>
        <PopoverTrigger
          render={
            <Button variant="outline" role="combobox" className="justify-between">
              <span className="truncate">{buttonLabel}</span>
              <ChevronsUpDown data-icon="inline-end" />
            </Button>
          }
        />
        <PopoverContent className="w-[280px] p-0" align="start">
          <Command>
            <CommandInput placeholder={`Search ${label.toLowerCase()}...`} />
            <CommandList>
              <CommandEmpty>No options found.</CommandEmpty>
              <CommandGroup>
                <ScrollArea className="max-h-72">
                  {values.map(value => (
                    <CommandItem
                      key={value}
                      value={value}
                      onSelect={() => {
                        const next = selectedSet.has(value)
                          ? selected.filter(item => item !== value)
                          : [...selected, value];
                        onSelectedChange(next);
                      }}
                    >
                      <Checkbox checked={selectedSet.has(value)} aria-label={value} />
                      <span className="truncate">{value}</span>
                    </CommandItem>
                  ))}
                </ScrollArea>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </LabeledControl>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border px-3 py-2">
      <div className="text-xs font-black uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-black text-[#361247]">{value}</div>
    </div>
  );
}

function ScoreChart({ rows, primaryScoreCol }: { rows: TurfRow[]; primaryScoreCol: string }) {
  const bins = Array.from({ length: 10 }, (_, index) => ({ label: `${index * 10}-${index * 10 + 9}`, count: 0 }));
  rows.forEach(row => {
    const score = Math.max(0, Math.min(99.99, primaryScore(row, primaryScoreCol)));
    bins[Math.floor(score / 10)].count += 1;
  });
  const max = Math.max(...bins.map(bin => bin.count), 1);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Score Distribution</CardTitle>
        <CardDescription>Filtered turfs by contribution likelihood score.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {bins.map(bin => (
          <div key={bin.label} className="grid grid-cols-[54px_1fr_72px] items-center gap-3 text-sm">
            <span className="font-medium text-muted-foreground">{bin.label}</span>
            <div className="h-3 overflow-hidden bg-muted">
              <div className="h-full bg-primary" style={{ width: `${(bin.count / max) * 100}%` }} />
            </div>
            <span className="text-right tabular-nums">{whole.format(bin.count)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function DataTable(props: {
  rows: TurfRow[];
  columns: string[];
  allRows: TurfRow[];
  sortColumn: string;
  sortDirection: "asc" | "desc";
  setSortColumn: (value: string) => void;
  setSortDirection: (value: "asc" | "desc") => void;
  numericColumns: Set<string>;
  columnStats: Map<string, ColumnStats>;
  comparisonMode: boolean;
  expandedKey: string;
  setExpandedKey: (value: string) => void;
}) {
  return (
    <div className="overflow-hidden border border-border">
      <ScrollArea className="w-full">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-card">Preview</TableHead>
              {props.columns.map(column => (
                <TableHead key={column} className="min-w-36">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                        variant="ghost"
                        className="h-auto justify-start px-0 py-1 text-left font-semibold"
                        onClick={() => {
                          if (props.sortColumn === column) {
                            props.setSortDirection(props.sortDirection === "asc" ? "desc" : "asc");
                          } else {
                            props.setSortColumn(column);
                            props.setSortDirection(props.numericColumns.has(column) ? "desc" : "asc");
                          }
                        }}
                      >
                        <span className="truncate">{labelize(column)}</span>
                        <ChevronDown data-icon="inline-end" className={cn(props.sortColumn === column && props.sortDirection === "asc" && "rotate-180")} />
                      </Button>
                      }
                    />
                    <TooltipContent>{column}</TooltipContent>
                  </Tooltip>
                </TableHead>
              ))}
            </TableRow>
            <TableRow>
              <TableHead className="sticky left-0 bg-muted font-medium">Average</TableHead>
              {props.columns.map(column => (
                <TableHead key={column} className="bg-muted font-medium">
                  {renderAverageCell(column, props.allRows, props.numericColumns)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.rows.map(row => {
              const key = rowKey(row);
              const expanded = props.expandedKey === key;
              return (
                <Fragment key={key}>
                  <TableRow key={key} className={expanded ? "bg-muted/60" : undefined}>
                    <TableCell className="sticky left-0 bg-card">
                      <Button variant="outline" size="sm" onClick={() => props.setExpandedKey(expanded ? "" : key)}>
                        {expanded ? "Hide" : "View"}
                      </Button>
                    </TableCell>
                    {props.columns.map(column => (
                      <TableCell key={column} className="max-w-64 align-top">
                        <FormattedCell
                          column={column}
                          value={row[column]}
                          row={row}
                          comparisonMode={props.comparisonMode}
                          stats={props.columnStats.get(column)}
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                  {expanded ? <PreviewRow row={row} colspan={props.columns.length + 1} /> : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}

function FormattedCell({ column, value, row, comparisonMode, stats }: {
  column: string;
  value: string;
  row: TurfRow;
  comparisonMode: boolean;
  stats?: ColumnStats;
}) {
  if (value === undefined || value === "") return <span className="text-muted-foreground">blank</span>;
  const formatted = formatCellValue(column, value);
  const tip = scoreTooltip(column, row);
  const valueNumber = number(value);
  if (!comparisonMode || !stats || !Number.isFinite(valueNumber)) {
    return tip ? (
      <Tooltip>
        <TooltipTrigger className="max-w-full truncate text-left">{formatted}</TooltipTrigger>
        <TooltipContent className="max-w-80">{tip}</TooltipContent>
      </Tooltip>
    ) : <span className="truncate">{formatted}</span>;
  }
  const delta = valueNumber - stats.average;
  return (
    <Tooltip>
      <TooltipTrigger className="flex max-w-full flex-col items-start gap-1 text-left">
        <span className="truncate">{formatted}</span>
        <Badge variant="outline" className="font-mono">{delta >= 0 ? "+" : ""}{formatColumnNumber(column, delta)} vs avg</Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-80">
        <div>{tip}</div>
        <Separator className="my-2" />
        <div>Average: {formatColumnNumber(column, stats.average)}</div>
        <div>Min: {formatColumnNumber(column, stats.min)}</div>
        <div>Max: {formatColumnNumber(column, stats.max)}</div>
      </TooltipContent>
    </Tooltip>
  );
}

function PreviewRow({ row, colspan }: { row: TurfRow; colspan: number }) {
  const lat = number(row.location_latitude);
  const lon = number(row.location_longitude);
  const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lon);
  const mapSrc = hasCoordinates ? `https://maps.google.com/maps?q=${encodeURIComponent(`${lat},${lon}`)}&z=14&output=embed` : "";
  const mapLink = row.map_url || (hasCoordinates ? `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lon}`)}` : "");
  return (
    <TableRow>
      <TableCell colSpan={colspan} className="bg-muted/40 p-4">
        <div className="grid gap-4 border border-border bg-card p-4 lg:grid-cols-[minmax(280px,0.8fr)_1fr]">
          <div className="aspect-video overflow-hidden border border-border bg-muted">
            {mapSrc ? <iframe title={`Map preview for ${row.display_location || row.GIDBG}`} src={mapSrc} className="size-full border-0" loading="lazy" /> : <div className="flex size-full items-center justify-center text-sm text-muted-foreground">No coordinates available.</div>}
          </div>
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-xs font-black uppercase text-primary">Area Preview</p>
              <h3 className="text-2xl font-black leading-tight">{row.display_location || row.local_area || row.GIDBG || "Selected turf"}</h3>
              <p className="text-sm text-muted-foreground">{row.County_name} · {row.municipality_name}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {["overall_score", "election_adjusted_score", "estimated_donors", "estimated_revenue"].map(column => (
                <div key={column} className="border border-border p-3">
                  <div className="text-xs text-muted-foreground">{labelize(column)}</div>
                  <div className="font-semibold">{formatCellValue(column, row[column])}</div>
                </div>
              ))}
            </div>
            {mapLink ? <a className="text-sm font-medium underline underline-offset-4" href={mapLink} target="_blank" rel="noreferrer">Open in Google Maps</a> : null}
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}

function TurfMap({ rows, rowsLoading, primaryScoreCol }: { rows: TurfRow[]; rowsLoading: boolean; primaryScoreCol: string }) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const turfLayerRef = useRef<LeafletGeoJSON | null>(null);
  const municipalLayerRef = useRef<LeafletGeoJSON | null>(null);
  const addressMarkerRef = useRef<LeafletLayer | null>(null);
  const radiusLayerRef = useRef<LeafletLayer | null>(null);
  const rankMarkerLayerRef = useRef<LayerGroup | null>(null);
  const parcelLayerRef = useRef<LayerGroup | null>(null);
  const customTurfLayerRef = useRef<LayerGroup | null>(null);
  const baseTileLayerRef = useRef<LeafletLayer & { setOpacity?: (opacity: number) => void } | null>(null);
  const parcelTileLoadingRef = useRef<Set<string>>(new Set());
  const parcelTileDataRef = useRef<Map<string, GeoJsonCollection>>(new Map());
  const [leaflet, setLeaflet] = useState<typeof import("leaflet") | null>(null);
  const [geojson, setGeojson] = useState<GeoJsonCollection | null>(null);
  const [municipalGeojson, setMunicipalGeojson] = useState<GeoJsonCollection | null>(null);
  const [parcelManifest, setParcelManifest] = useState<ParcelTileManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showParcelDots, setShowParcelDots] = useState(true);
  const [activeLayerField, setActiveLayerField] = useState("map_priority_index");
  const [activePreset, setActivePreset] = useState("");
  const [activeGeographyPreset, setActiveGeographyPreset] = useState("");
  const [mapCounties, setMapCounties] = useState<string[]>([]);
  const [mapMunicipalities, setMapMunicipalities] = useState<string[]>([]);
  const [rawLayers, setRawLayers] = useState<MapLayerDefinition[]>([]);
  const [mapViewVersion, setMapViewVersion] = useState(0);
  const [mapZoom, setMapZoom] = useState(8);
  const [parcelLoadedTileCount, setParcelLoadedTileCount] = useState(0);
  const [parcelRadiusCount, setParcelRadiusCount] = useState(0);
  const [canvassQuery, setCanvassQuery] = useState("1000 Commonwealth Ave, Newton, MA");
  const [canvassRadiusMiles, setCanvassRadiusMiles] = useState("1");
  const [canvassCrewSize, setCanvassCrewSize] = useState("3");
  const [canvassShiftHours, setCanvassShiftHours] = useState("3");
  const [canvassArea, setCanvassArea] = useState<CanvassArea | null>(null);
  const [canvassBuilding, setCanvassBuilding] = useState(false);
  const [selectedGid, setSelectedGid] = useState("");
  const [turfMode, setTurfMode] = useState(false);
  const [draftTurfPoints, setDraftTurfPoints] = useState<TurfPoint[]>([]);
  const [drawnTurfs, setDrawnTurfs] = useState<DrawnTurf[]>(() => readDrawnTurfs());
  const [selectedDrawnTurfId, setSelectedDrawnTurfId] = useState("");
  const [drawnTurfStats, setDrawnTurfStats] = useState<Record<string, DrawnTurfStats>>({});

  const activeLayer = useMemo(
    () => [...mapLayerCatalog, ...rawLayers].find(layer => layer.field === activeLayerField) ?? mapLayerCatalog[0],
    [activeLayerField, rawLayers],
  );
  const mapGeographyOptions = useMemo(() => ({
    counties: unique((geojson?.features || []).map(feature => String(feature.properties?.County_name || "")).filter(Boolean)),
    municipalities: unique((geojson?.features || []).map(feature => String(feature.properties?.municipality_name || "")).filter(Boolean)),
  }), [geojson]);
  const parcelStatus = !showParcelDots
    ? "House dots are off."
    : !parcelManifest
      ? "Generate parcel tiles to enable house dots."
      : mapZoom < (parcelManifest.min_display_zoom ?? defaultParcelMinZoom)
      ? `Zoom to ${parcelManifest.min_display_zoom ?? defaultParcelMinZoom}+ to show house dots.`
      : `Showing house dots from ${parcelLoadedTileCount} loaded tiles.`;
  const selectedDrawnTurf = useMemo(
    () => drawnTurfs.find(turf => turf.id === selectedDrawnTurfId) ?? drawnTurfs[0] ?? null,
    [drawnTurfs, selectedDrawnTurfId],
  );
  const selectedDrawnTurfStats = selectedDrawnTurf ? drawnTurfStats[selectedDrawnTurf.id] : null;
  const filteredGeojson = useMemo(() => {
    if (!geojson) return null;
    if (canvassArea) {
      const contextRadius = Math.max(canvassArea.radiusMiles * 2.25, canvassArea.radiusMiles + 1.5);
      return {
        type: "FeatureCollection",
        features: geojson.features.filter(feature => {
          const center = mapFeatureLocation(feature);
          return center ? distanceMiles(canvassArea.location.lat, canvassArea.location.lon, center.lat, center.lon) <= contextRadius : false;
        }),
      } satisfies GeoJsonCollection;
    }
    const geographyPreset = activeGeographyPreset ? mapGeographyPresetDefinitions[activeGeographyPreset] : null;
    const presetCountySet = new Set(geographyPreset?.counties || []);
    const presetMunicipalitySet = new Set(geographyPreset?.municipalities || []);
    const countySet = new Set(mapCounties);
    const municipalitySet = new Set(mapMunicipalities);
    const hasGeography = Boolean(geographyPreset || countySet.size || municipalitySet.size);
    const scorePreset = activePreset ? mapPresetDefinitions[activePreset] : null;
    const features = hasGeography
      ? geojson.features.filter(feature => {
          const county = String(feature.properties?.County_name || "");
          const municipality = String(feature.properties?.municipality_name || "");
          const matchesGeography = countySet.has(county) || municipalitySet.has(municipality) || presetCountySet.has(county) || presetMunicipalitySet.has(municipality);
          return matchesGeography && (!scorePreset || scorePreset.test(feature.properties || {}));
        })
      : [];
    return { type: "FeatureCollection", features } satisfies GeoJsonCollection;
  }, [activeGeographyPreset, activePreset, canvassArea, geojson, mapCounties, mapMunicipalities]);
  const filteredMunicipalGeojson = useMemo(() => {
    if (!municipalGeojson || !filteredGeojson) return null;
    const visibleMunicipalities = new Set(filteredGeojson.features.map(feature => String(feature.properties?.municipality_name || "")).filter(Boolean));
    return {
      type: "FeatureCollection",
      features: municipalGeojson.features.filter(feature => visibleMunicipalities.has(municipalityLabel(feature.properties))),
    } satisfies GeoJsonCollection;
  }, [filteredGeojson, municipalGeojson]);

  const zoomToFeature = useCallback((gid: string) => {
    const map = mapRef.current;
    const layerGroup = turfLayerRef.current;
    if (!map || !layerGroup) return;
    layerGroup.eachLayer(layer => {
      const feature = (layer as LeafletLayer & { feature?: GeoJsonFeature }).feature;
      const properties = feature?.properties || {};
      if (featureGid(properties) !== gid) return;
      if ("getBounds" in layer) map.fitBounds((layer as Polygon).getBounds(), { maxZoom: 15, padding: [48, 48] });
      layer.bindPopup(mapPopupHtml(properties, activeLayer)).openPopup();
    });
  }, [activeLayer]);

  const deferParcelCounts = useCallback((tileCount: number, radiusCount: number) => {
    window.setTimeout(() => {
      setParcelLoadedTileCount(tileCount);
      setParcelRadiusCount(radiusCount);
    }, 0);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch(mapGeojsonPath, { cache: "no-store" }).then(response => response.ok ? response.json() : Promise.reject(new Error("Block-group GeoJSON failed to load."))),
      fetch(municipalGeojsonPath, { cache: "no-store" }).then(response => response.ok ? response.json() : Promise.reject(new Error("Municipality GeoJSON failed to load."))),
    ])
      .then(([blockGroups, municipalitiesJson]) => {
        setGeojson(blockGroups);
        setMunicipalGeojson(municipalitiesJson);
        setRawLayers(detectRawMapLayers(blockGroups));
        setLoading(false);
      })
      .catch(nextError => {
        setError(nextError instanceof Error ? nextError.message : "Unable to load map data.");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    import("leaflet").then(setLeaflet);
  }, []);

  useEffect(() => {
    fetch(parcelTileManifestPath, { cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then((manifest: ParcelTileManifest | null) => setParcelManifest(manifest))
      .catch(() => setParcelManifest(null));
  }, []);

  useEffect(() => {
    localStorage.setItem(drawnTurfStorageKey, JSON.stringify(drawnTurfs));
  }, [drawnTurfs]);

  useEffect(() => {
    if (!leaflet || !mapNodeRef.current || mapRef.current) return;
    const map = leaflet.map(mapNodeRef.current, { preferCanvas: true }).setView([42.25, -71.8], 8);
    mapRef.current = map;
    const tileLayer = leaflet.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    baseTileLayerRef.current = tileLayer;
    const bumpMapViewVersion = () => {
      setMapZoom(map.getZoom());
      setMapViewVersion(version => version + 1);
    };
    map.on("moveend zoomend", bumpMapViewVersion);
    return () => {
      map.off("moveend zoomend", bumpMapViewVersion);
      map.remove();
      mapRef.current = null;
      baseTileLayerRef.current = null;
    };
  }, [leaflet]);

  useEffect(() => {
    baseTileLayerRef.current?.setOpacity?.(turfMode ? 0.48 : 1);
    mapNodeRef.current?.classList.toggle("gbh-turf-mode-map", turfMode);
  }, [turfMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!leaflet || !map) return;
    const addDraftPoint = (event: { latlng: { lat: number; lng: number }; originalEvent?: Event }) => {
      if (!turfMode) return;
      event.originalEvent?.preventDefault();
      setDraftTurfPoints(points => [...points, { lat: event.latlng.lat, lon: event.latlng.lng }]);
    };
    map.on("contextmenu", addDraftPoint);
    return () => {
      map.off("contextmenu", addDraftPoint);
    };
  }, [leaflet, turfMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!leaflet || !map || !filteredGeojson || !filteredMunicipalGeojson) return;
    turfLayerRef.current?.remove();
    municipalLayerRef.current?.remove();
    rankMarkerLayerRef.current?.remove();
    const preset = activePreset ? mapPresetDefinitions[activePreset] : null;
    turfLayerRef.current = leaflet.geoJSON(filteredGeojson as GeoJSON.GeoJsonObject, {
      style: feature => mapFeatureStyle(feature as GeoJsonFeature, activeLayer, activeLayerField, filteredGeojson, preset, canvassArea, selectedGid, turfMode),
      onEachFeature: (feature, layer) => {
        const properties = (feature as GeoJsonFeature).properties || {};
        layer.bindTooltip(mapTooltipHtml(properties, activeLayer), { sticky: true });
        layer.bindPopup(mapPopupHtml(properties, activeLayer));
        layer.on("click", () => setSelectedGid(featureGid(properties)));
      },
    }).addTo(map);
    municipalLayerRef.current = leaflet.geoJSON(filteredMunicipalGeojson as GeoJSON.GeoJsonObject, {
      interactive: true,
      style: { color: "#111827", weight: 2.8, opacity: 0.98, fillOpacity: 0, lineCap: "round", lineJoin: "round" },
      onEachFeature: (feature, layer) => {
        const label = municipalityLabel((feature as GeoJsonFeature).properties);
        layer.bindTooltip(label, {
          className: "municipality-map-label",
          direction: "center",
          opacity: 0.98,
          permanent: true,
        });
        layer.bindPopup(`<strong>${escapeHtml(label)}</strong><br>Municipality boundary`);
        layer.on({
          mouseover: event => {
            event.target.setStyle({ color: "#000000", opacity: 1, weight: 4 });
            event.target.bringToFront();
          },
          mouseout: event => municipalLayerRef.current?.resetStyle(event.target),
        });
      },
    }).addTo(map);
    const rankLayer = leaflet.layerGroup().addTo(map);
    rankMarkerLayerRef.current = rankLayer;
    canvassArea?.recommendations.slice(0, 8).forEach(item => {
      const location = rowLocation(item.row);
      if (!location) return;
      leaflet.marker([location.lat, location.lon], {
        icon: leaflet.divIcon({
          className: "gbh-rank-marker",
          html: `<span>${item.rank}</span>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        }),
      })
        .on("click", () => {
          setSelectedGid(rowKey(item.row));
          zoomToFeature(rowKey(item.row));
        })
        .addTo(rankLayer);
    });
    if (!canvassArea) {
      try {
        map.fitBounds(turfLayerRef.current.getBounds(), { padding: [18, 18] });
      } catch {
        map.setView([42.25, -71.8], 8);
      }
    }
  }, [activeLayer, activeLayerField, activePreset, canvassArea, filteredGeojson, filteredMunicipalGeojson, leaflet, selectedGid, turfMode, zoomToFeature]);

  useEffect(() => {
    const map = mapRef.current;
    if (!leaflet || !map) return;
    const layerGroup = customTurfLayerRef.current ?? leaflet.layerGroup().addTo(map);
    customTurfLayerRef.current = layerGroup;
    layerGroup.clearLayers();

    drawnTurfs.forEach((turf, index) => {
      if (turf.points.length < 3) return;
      const selected = turf.id === selectedDrawnTurf?.id;
      const polygon = leaflet.polygon(turf.points.map(point => [point.lat, point.lon]), {
        color: selected ? "#361247" : customTurfColor(index),
        fillColor: customTurfColor(index),
        fillOpacity: selected ? 0.28 : 0.16,
        opacity: 0.96,
        weight: selected ? 4 : 2.4,
      }).addTo(layerGroup);
      polygon.bindTooltip(turf.name, { sticky: true });
      polygon.on("click", () => setSelectedDrawnTurfId(turf.id));
    });

    if (draftTurfPoints.length) {
      const latLngs = draftTurfPoints.map(point => [point.lat, point.lon] as [number, number]);
      if (draftTurfPoints.length > 1) {
        leaflet.polyline(latLngs, { color: "#f5de00", opacity: 1, weight: 3, dashArray: "6 5" }).addTo(layerGroup);
      }
      draftTurfPoints.forEach((point, index) => {
        leaflet.circleMarker([point.lat, point.lon], {
          radius: 5,
          color: "#361247",
          fillColor: "#f5de00",
          fillOpacity: 1,
          weight: 2,
        }).bindTooltip(`Point ${index + 1}`).addTo(layerGroup);
      });
    }
  }, [draftTurfPoints, drawnTurfs, leaflet, selectedDrawnTurf?.id]);

  useEffect(() => {
    const map = mapRef.current;
    if (!leaflet || !map) return;
    if (!canvassArea) {
      addressMarkerRef.current?.remove();
      addressMarkerRef.current = null;
      radiusLayerRef.current?.remove();
      radiusLayerRef.current = null;
      return;
    }
    addressMarkerRef.current?.remove();
    radiusLayerRef.current?.remove();
    const { location, radiusMiles } = canvassArea;
    const marker = leaflet.circleMarker([location.lat, location.lon], {
      radius: 9,
      color: "#361247",
      weight: 3,
      opacity: 0.95,
      fillColor: "#f5de00",
      fillOpacity: 0.95,
    }).addTo(map);
    const radius = leaflet.circle([location.lat, location.lon], {
      radius: radiusMiles * 1609.344,
      color: "#f5de00",
      fillColor: "#f5de00",
      fillOpacity: 0.08,
      opacity: 0.95,
      weight: 3,
    }).addTo(map);
    marker.bindPopup(`<strong>${escapeHtml(location.label)}</strong><br>${nf.format(radiusMiles)} mile canvass radius`);
    addressMarkerRef.current = marker;
    radiusLayerRef.current = radius;
    map.fitBounds(radius.getBounds(), { animate: true, maxZoom: 15, paddingTopLeft: [40, 140], paddingBottomRight: [430, 40] });
    marker.openPopup();
  }, [canvassArea, leaflet]);

  useEffect(() => {
    const map = mapRef.current;
    if (!leaflet || !map) return;
    const minZoom = parcelManifest?.min_display_zoom ?? defaultParcelMinZoom;
    const tileZoom = parcelManifest?.tile_zoom ?? defaultParcelTileZoom;

    if (!showParcelDots) {
      parcelLayerRef.current?.remove();
      parcelLayerRef.current = null;
      deferParcelCounts(0, 0);
      return;
    }

    if (!parcelManifest) {
      return;
    }

    if (map.getZoom() < minZoom) {
      parcelLayerRef.current?.remove();
      parcelLayerRef.current = null;
      deferParcelCounts(0, 0);
      return;
    }

    const layerGroup = parcelLayerRef.current ?? leaflet.layerGroup().addTo(map);
    parcelLayerRef.current = layerGroup;
    layerGroup.clearLayers();
    const tileKeys = visibleParcelTileKeys(map, tileZoom);
    let renderedTiles = 0;
    let radiusDots = 0;
    const renderTile = (tile: GeoJsonCollection) => {
      const features = canvassArea
        ? tile.features.filter(feature => pointFeatureWithinRadius(feature, canvassArea.location, canvassArea.radiusMiles))
        : tile.features;
      if (canvassArea) radiusDots += features.length;
      if (!features.length) return;
      renderedTiles += 1;
      leaflet.geoJSON({ ...tile, features } as GeoJSON.GeoJsonObject, {
        pointToLayer: (feature, latlng) => leaflet.circleMarker(latlng, parcelDotStyle(feature as GeoJsonFeature, parcelManifest)),
        onEachFeature: (feature, layer) => {
          const properties = (feature as GeoJsonFeature).properties || {};
          layer.bindTooltip(parcelTooltipHtml(properties), { sticky: true });
          layer.bindPopup(parcelPopupHtml(properties));
        },
      }).addTo(layerGroup);
    };

    tileKeys.forEach(key => {
      const cachedTile = parcelTileDataRef.current.get(key);
      if (cachedTile) renderTile(cachedTile);
    });
    deferParcelCounts(renderedTiles, canvassArea ? radiusDots : 0);

    const uncachedTileKeys = tileKeys.filter(key => !parcelTileDataRef.current.has(key) && !parcelTileLoadingRef.current.has(key));

    uncachedTileKeys.forEach(key => {
      parcelTileLoadingRef.current.add(key);
      const [z, x, y] = key.split("/").map(Number);
      fetch(`/data/parcel-tiles/${z}/${x}/${y}.geojson`)
        .then(response => response.ok ? response.json() : null)
        .then((tile: GeoJsonCollection | null) => {
          parcelTileLoadingRef.current.delete(key);
          if (tile) parcelTileDataRef.current.set(key, tile);
          setMapViewVersion(version => version + 1);
        })
        .catch(() => {
          parcelTileLoadingRef.current.delete(key);
        });
    });
  }, [canvassArea, deferParcelCounts, leaflet, mapViewVersion, parcelManifest, showParcelDots]);

  useEffect(() => {
    if (!geojson || !drawnTurfs.length) {
      window.setTimeout(() => setDrawnTurfStats({}), 0);
      return;
    }
    let cancelled = false;
    const initialStats = Object.fromEntries(drawnTurfs.map(turf => {
      const cachedHousing = countTurfHousingFromTiles(turf, turfTileKeys(turf, parcelManifest?.tile_zoom ?? defaultParcelTileZoom), parcelTileDataRef.current);
      return [
        turf.id,
        summarizeDrawnTurf(turf, geojson, primaryScoreCol, cachedHousing.counts, cachedHousing.total, Boolean(parcelManifest), false),
      ];
    }));
    window.setTimeout(() => {
      if (!cancelled) setDrawnTurfStats(initialStats);
    }, 0);

    if (!parcelManifest) return;
    Promise.all(drawnTurfs.map(async turf => {
      const tileZoom = parcelManifest.tile_zoom ?? defaultParcelTileZoom;
      const tileKeys = turfTileKeys(turf, tileZoom);
      const tooLargeForParcels = tileKeys.length > maxTurfParcelTiles;
      if (tooLargeForParcels) {
        return [turf.id, summarizeDrawnTurf(turf, geojson, primaryScoreCol, {}, 0, false, true)] as const;
      }
      const tiles = await Promise.all(tileKeys.map(async key => {
        const cached = parcelTileDataRef.current.get(key);
        if (cached) return cached;
        try {
          const [z, x, y] = key.split("/").map(Number);
          const response = await fetch(`/data/parcel-tiles/${z}/${x}/${y}.geojson`);
          if (!response.ok) return null;
          const tile = await response.json() as GeoJsonCollection;
          parcelTileDataRef.current.set(key, tile);
          return tile;
        } catch {
          return null;
        }
      }));
      const housing = countTurfHousingFromTileList(turf, tiles);
      return [turf.id, summarizeDrawnTurf(turf, geojson, primaryScoreCol, housing.counts, housing.total, false, false)] as const;
    })).then(entries => {
      if (!cancelled) setDrawnTurfStats(Object.fromEntries(entries));
    }).catch(() => {
      if (!cancelled) setDrawnTurfStats(current => Object.fromEntries(Object.entries(current).map(([id, stats]) => [id, { ...stats, loadingHousing: false }])));
    });
    return () => {
      cancelled = true;
    };
  }, [drawnTurfs, geojson, parcelManifest, primaryScoreCol]);

  const insightRows = useMemo(() => {
    if (canvassArea) {
      return canvassArea.recommendations.slice(0, 8).map(item => ({
        gid: rowKey(item.row),
        label: item.row.display_location || item.row.municipality_name || rowKey(item.row),
        value: item.score,
        action: item.action,
      }));
    }
    if (!filteredGeojson) return [];
    return filteredGeojson.features
      .map(feature => ({ feature, value: mapValue(feature.properties, activeLayerField) }))
      .filter(item => Number.isFinite(item.value))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
      .map(({ feature, value }) => {
        const properties = feature.properties || {};
        return {
          gid: featureGid(properties),
          label: String(properties.display_location || properties.municipality_name || featureGid(properties)),
          value,
          action: String(properties.recommended_outreach_channel || "channel n/a"),
        };
      });
  }, [activeLayerField, canvassArea, filteredGeojson]);

  async function buildCanvass(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const query = canvassQuery.trim();
    if (!query) return;
    if (!rows.length || !geojson) {
      toast.error(rowsLoading ? "Turf data is still loading." : "Map data is still loading.");
      return;
    }

    setCanvassBuilding(true);
    try {
      const location = parseCoordinates(query) ?? await geocodeAddress(query);
      if (!location) throw new Error("No matching address found.");

      const nearest = nearestMapFeature(location, geojson);
      if (!nearest || nearest.distance > 60) {
        throw new Error("That address is not close enough to a Massachusetts block group.");
      }

      const radius = Math.max(0.1, Number(canvassRadiusMiles || 1));
      const next = buildCanvassAreaFromLocation(location, rows, primaryScoreCol, radius);
      setCanvassArea(next);
      setSelectedGid(next.recommendations[0] ? rowKey(next.recommendations[0].row) : "");
      setActiveLayerField("map_priority_index");
      setActivePreset("");
      setActiveGeographyPreset("");
      setMapCounties([]);
      setMapMunicipalities([]);
      setShowParcelDots(true);
      toast.success(`Canvass map ready for ${location.label}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to build that canvass map.");
    } finally {
      setCanvassBuilding(false);
    }
  }

  function copyCanvassPlan() {
    if (!canvassArea) return;
    const { summary } = canvassArea;
    const lines = [
      `GBH canvass map: ${canvassArea.location.label}`,
      `Radius: ${nf.format(canvassArea.radiusMiles)} mi`,
      `Decision: ${summary.decision} - ${summary.decisionReason}`,
      `Households: ${whole.format(summary.households)} | Mission fit: ${nf.format(summary.missionAlignment)} | House dots loaded in radius: ${whole.format(parcelRadiusCount)} | Donors: ${nf.format(summary.donors)} | Revenue: ${money.format(summary.revenue)}`,
      "",
      ...canvassArea.recommendations.slice(0, 8).map(item => [
        `${item.rank}. ${item.row.display_location || item.row.GIDBG}`,
        `${item.action} | score ${nf.format(item.score)} | ${item.distance !== undefined ? `${nf.format(item.distance)} mi` : "distance n/a"}`,
        `Households ${formatCellValue("estimated_canvassable_households", item.row.estimated_canvassable_households)} | fit ${formatCellValue("mission_alignment_index", item.row.mission_alignment_index)} | access ${formatCellValue("door_access_index", item.row.door_access_index)} | avoid ${formatCellValue("avoid_pressure_index", item.row.avoid_pressure_index)}`,
        item.messaging,
      ].join("\n")),
    ];
    navigator.clipboard.writeText(lines.join("\n\n"));
    toast.success("Canvass plan copied.");
  }

  function exportCanvassCsv() {
    if (!canvassArea) return;
    const columns = ["rank", "action", "planner_score", "distance_miles", "rationale", ...columnPresets.planner];
    const lines = [
      ["address", "radius_miles", "decision", "canvassable_households", "mission_alignment", "opposition_risk", "parcel_house_dots_loaded", "estimated_donors", "estimated_revenue"].join(","),
      [
        csvEscape(canvassArea.location.label),
        canvassArea.radiusMiles,
        canvassArea.summary.decision,
        canvassArea.summary.households,
        canvassArea.summary.missionAlignment,
        canvassArea.summary.oppositionRisk,
        parcelRadiusCount,
        canvassArea.summary.donors,
        canvassArea.summary.revenue,
      ].map(value => csvEscape(String(value))).join(","),
      "",
      columns.join(","),
      ...canvassArea.recommendations.map(item => columns.map(column => {
        const value = column === "rank"
          ? item.rank
          : column === "action"
            ? item.action
            : column === "planner_score"
              ? item.score.toFixed(2)
              : column === "distance_miles"
                ? item.distance?.toFixed(2) ?? ""
                : column === "rationale"
                  ? item.rationale.join("; ")
                  : item.row[column] ?? "";
        return csvEscape(String(value));
      }).join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `gbh-canvass-map-${slugify(canvassArea.location.label)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function finishDraftTurf() {
    if (draftTurfPoints.length < 3) {
      toast.error("A turf needs at least 3 right-click points.");
      return;
    }
    const next: DrawnTurf = {
      id: `turf-${Date.now()}`,
      name: `Turf ${drawnTurfs.length + 1}`,
      points: draftTurfPoints,
      createdAt: new Date().toISOString(),
    };
    setDrawnTurfs(current => [...current, next]);
    setSelectedDrawnTurfId(next.id);
    setDraftTurfPoints([]);
    toast.success(`${next.name} created.`);
  }

  function renameDrawnTurf(turfId: string, name: string) {
    setDrawnTurfs(current => current.map(turf => turf.id === turfId ? { ...turf, name } : turf));
  }

  function deleteDrawnTurf(turfId: string) {
    setDrawnTurfs(current => current.filter(turf => turf.id !== turfId));
    setSelectedDrawnTurfId(current => current === turfId ? "" : current);
  }

  function zoomToDrawnTurf(turf: DrawnTurf) {
    const map = mapRef.current;
    if (!leaflet || !map || turf.points.length < 3) return;
    const bounds = leaflet.latLngBounds(turf.points.map(point => [point.lat, point.lon]));
    map.fitBounds(bounds, { animate: true, maxZoom: 16, paddingTopLeft: [40, 140], paddingBottomRight: [430, 40] });
  }

  function copyDrawnTurfSummary() {
    if (!selectedDrawnTurf || !selectedDrawnTurfStats) return;
    const topHousing = topHousingTypes(selectedDrawnTurfStats, parcelManifest).slice(0, 8);
    const lines = [
      `GBH custom turf: ${selectedDrawnTurf.name}`,
      `Block groups: ${whole.format(selectedDrawnTurfStats.blockGroups)}`,
      `House dots counted: ${whole.format(selectedDrawnTurfStats.housingTotal)}`,
      `Households: ${whole.format(selectedDrawnTurfStats.households)} | Donors: ${nf.format(selectedDrawnTurfStats.donors)} | Revenue: ${money.format(selectedDrawnTurfStats.revenue)}`,
      `Priority: ${nf.format(selectedDrawnTurfStats.averagePriority)} | Mission fit: ${nf.format(selectedDrawnTurfStats.missionAlignment)} | Door access: ${nf.format(selectedDrawnTurfStats.doorAccess)}`,
      "",
      "House types:",
      ...(topHousing.length ? topHousing.map(item => `${item.label}: ${whole.format(item.count)} (${nf.format(item.share)}%)`) : ["No parcel dots counted."]),
      "",
      "Demographics:",
      ...selectedDrawnTurfStats.demographics.map(item => `${item.label}: ${item.value}`),
    ];
    navigator.clipboard.writeText(lines.join("\n"));
    toast.success("Turf summary copied.");
  }

  function exportDrawnTurfCsv() {
    if (!selectedDrawnTurf || !selectedDrawnTurfStats) return;
    const rowsOut = [
      ["turf", "block_groups", "house_dots", "households", "donors", "revenue", "priority", "mission_fit", "door_access", "avoid_pressure", "opposition_risk"].join(","),
      [
        selectedDrawnTurf.name,
        selectedDrawnTurfStats.blockGroups,
        selectedDrawnTurfStats.housingTotal,
        selectedDrawnTurfStats.households,
        selectedDrawnTurfStats.donors,
        selectedDrawnTurfStats.revenue,
        selectedDrawnTurfStats.averagePriority,
        selectedDrawnTurfStats.missionAlignment,
        selectedDrawnTurfStats.doorAccess,
        selectedDrawnTurfStats.avoidPressure,
        selectedDrawnTurfStats.oppositionRisk,
      ].map(value => csvEscape(String(value))).join(","),
      "",
      ["house_type", "count", "share"].join(","),
      ...topHousingTypes(selectedDrawnTurfStats, parcelManifest).map(item => [item.label, item.count, item.share.toFixed(2)].map(value => csvEscape(String(value))).join(",")),
      "",
      ["demographic", "value"].join(","),
      ...selectedDrawnTurfStats.demographics.map(item => [item.label, item.value].map(value => csvEscape(String(value))).join(",")),
    ];
    const blob = new Blob([rowsOut.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `gbh-custom-turf-${slugify(selectedDrawnTurf.name)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <CardTitle>Unified Canvass Map</CardTitle>
          <CardDescription>
            {loading ? "Loading scored block groups..." : error || mapStatusText(geojson, filteredGeojson, activeGeographyPreset, canvassArea)}
          </CardDescription>
        </div>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
          <LabeledControl label="Area preset">
            <Select value={activeGeographyPreset || "none"} onValueChange={value => {
              const selectedValue = value || "none";
              const next = selectedValue === "none" ? "" : selectedValue;
              setCanvassArea(null);
              setActiveGeographyPreset(next);
              setMapCounties([]);
              setMapMunicipalities([]);
            }}>
              <SelectTrigger className="w-full md:w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="none">Choose area</SelectItem>
                  {Object.entries(mapGeographyPresetDefinitions).map(([key, preset]) => <SelectItem key={key} value={key}>{preset.label}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
          </LabeledControl>
          <MultiSelect label="Map counties" values={mapGeographyOptions.counties} selected={mapCounties} onSelectedChange={next => { setCanvassArea(null); setActiveGeographyPreset(""); setMapCounties(next); }} emptyLabel="Choose counties" />
          <MultiSelect label="Map municipalities" values={mapGeographyOptions.municipalities} selected={mapMunicipalities} onSelectedChange={next => { setCanvassArea(null); setActiveGeographyPreset(""); setMapMunicipalities(next); }} emptyLabel="Choose towns" />
          <LabeledControl label="Layer">
            <Select value={activeLayerField} onValueChange={value => { if (!value) return; setActiveLayerField(value); setActivePreset(""); }}>
              <SelectTrigger className="w-full md:w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>{mapLayerCatalog.map(layer => <SelectItem key={layer.field} value={layer.field}>{layer.label}</SelectItem>)}</SelectGroup>
              </SelectContent>
            </Select>
          </LabeledControl>
          <LabeledControl label="Preset">
            <Select value={activePreset || "none"} onValueChange={value => {
              if (!value) return;
              const next = value === "none" ? "" : value;
              setActivePreset(next);
              if (next) setActiveLayerField(mapPresetDefinitions[next].layer);
            }}>
              <SelectTrigger className="w-full md:w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="none">No preset</SelectItem>
                  {Object.entries(mapPresetDefinitions).map(([key, preset]) => <SelectItem key={key} value={key}>{preset.label}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
          </LabeledControl>
          <LabeledControl label="Raw stat">
            <Select value={rawLayers.some(layer => layer.field === activeLayerField) ? activeLayerField : "none"} onValueChange={value => {
              if (!value) return;
              if (value === "none") return;
              setActiveLayerField(value);
              setActivePreset("");
            }}>
              <SelectTrigger className="w-full md:w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="none">{rawLayers.length ? "Choose raw stat" : "Loading raw stats..."}</SelectItem>
                  {rawLayers.map(layer => <SelectItem key={layer.field} value={layer.field}>{layer.label}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
          </LabeledControl>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {error ? <p className="m-4 border border-destructive bg-destructive/10 p-4 text-sm font-medium text-destructive">{error}</p> : null}
        <div className="relative h-[78vh] min-h-[680px] bg-muted">
          <div ref={mapNodeRef} className="size-full" aria-label="Block group choropleth map" />
          <form onSubmit={buildCanvass} className="absolute left-14 right-4 top-4 z-[650] grid gap-2 bg-card/95 p-3 shadow-xl backdrop-blur md:grid-cols-[minmax(240px,1fr)_92px_78px_78px_auto] lg:right-[430px]">
            <LabeledControl label="Address">
              <InputGroup className="bg-background">
                <InputGroupAddon><Search /></InputGroupAddon>
                <InputGroupInput
                  value={canvassQuery}
                  onChange={event => setCanvassQuery(event.target.value)}
                  placeholder="Street address or coordinates"
                  aria-label="Canvass address"
                />
              </InputGroup>
            </LabeledControl>
            <LabeledControl label="Radius">
              <Input
                type="number"
                min="0.1"
                step="0.1"
                value={canvassRadiusMiles}
                onChange={event => {
                  const next = event.target.value;
                  setCanvassRadiusMiles(next);
                  setCanvassArea(current => current ? buildCanvassAreaFromLocation(current.location, rows, primaryScoreCol, Number(next || current.radiusMiles)) : current);
                }}
              />
            </LabeledControl>
            <LabeledControl label="Crew">
              <Input type="number" min="1" step="1" value={canvassCrewSize} onChange={event => setCanvassCrewSize(event.target.value)} />
            </LabeledControl>
            <LabeledControl label="Hours">
              <Input type="number" min="0.5" step="0.5" value={canvassShiftHours} onChange={event => setCanvassShiftHours(event.target.value)} />
            </LabeledControl>
            <div className="flex items-end">
              <Button type="submit" disabled={canvassBuilding || loading || rowsLoading}>
                {canvassBuilding ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Navigation data-icon="inline-start" />}
                Build Canvass
              </Button>
            </div>
          </form>
          <div className="absolute left-14 top-[132px] z-[560] flex max-w-[calc(100%-5rem)] flex-wrap gap-2 lg:top-24">
            <LayerChip label="Field Priority" active={activeLayerField === "map_priority_index"} onClick={() => { setActiveLayerField("map_priority_index"); setActivePreset(""); }} />
            <LayerChip label="Mission Fit" active={activeLayerField === "mission_alignment_index"} onClick={() => { setActiveLayerField("mission_alignment_index"); setActivePreset(""); }} />
            <LayerChip label="Door Access" active={activeLayerField === "door_access_index"} onClick={() => { setActiveLayerField("door_access_index"); setActivePreset(""); }} />
            <LayerChip label="Avoid Pressure" active={activeLayerField === "avoid_pressure_index"} onClick={() => { setActiveLayerField("avoid_pressure_index"); setActivePreset(""); }} />
            <LayerChip label="Target Fit" active={activeLayerField === "target_presence_index"} onClick={() => { setActiveLayerField("target_presence_index"); setActivePreset(""); }} />
            <LayerChip label="House Dots" active={showParcelDots} onClick={() => setShowParcelDots(value => !value)} />
            <LayerChip label="Create Turfs" active={turfMode} onClick={() => setTurfMode(value => !value)} />
          </div>
          {turfMode ? (
            <div className="absolute left-14 top-[188px] z-[620] flex max-w-[calc(100%-5rem)] flex-wrap items-center gap-2 border border-border bg-card/95 p-3 text-sm shadow-xl backdrop-blur lg:top-36 lg:left-[390px] lg:max-w-[calc(100%-53rem)]">
              <MousePointer2 className="text-primary" />
              <span className="font-medium">{draftTurfPoints.length ? `${draftTurfPoints.length} points placed` : "Right-click the map to place turf points."}</span>
              <Button type="button" size="sm" onClick={finishDraftTurf} disabled={draftTurfPoints.length < 3}>
                <Pencil data-icon="inline-start" />Finish
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setDraftTurfPoints(points => points.slice(0, -1))} disabled={!draftTurfPoints.length}>
                <RotateCcw data-icon="inline-start" />Undo
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setDraftTurfPoints([])} disabled={!draftTurfPoints.length}>Cancel</Button>
            </div>
          ) : null}
          <div className="absolute left-14 top-[188px] z-[500] max-h-[calc(100%-13rem)] w-[min(360px,calc(100%-5rem))] overflow-auto border border-border bg-card/95 p-3 shadow-xl backdrop-blur lg:top-36">
            <div className="flex items-center gap-2">
              <Layers className="text-muted-foreground" />
              <div>
                <h3 className="font-black uppercase">{activePreset ? mapPresetDefinitions[activePreset].label : activeLayer.label}</h3>
                <p className="text-xs text-muted-foreground">{activePreset ? mapPresetDefinitions[activePreset].description : activeLayer.description}</p>
              </div>
            </div>
            <Separator className="my-3" />
            <div className="flex flex-col gap-2">
              {loading ? Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />) : null}
              {!loading && !insightRows.length ? <p className="border border-border bg-muted/40 p-3 text-sm font-medium text-muted-foreground">Enter an address to build a canvass map, or choose an area preset for broad exploration.</p> : null}
              {insightRows.map(item => {
                return (
                  <Button key={item.gid} variant={selectedGid === item.gid ? "secondary" : "ghost"} className="h-auto justify-start p-2 text-left" onClick={() => { setSelectedGid(item.gid); zoomToFeature(item.gid); }}>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{item.label}</span>
                      <span className="text-xs text-muted-foreground">{formatMapValue(item.value, activeLayer)} · {item.action}</span>
                    </span>
                  </Button>
                );
              })}
            </div>
          </div>
          {turfMode ? (
            <CustomTurfPanel
              turfs={drawnTurfs}
              selectedTurf={selectedDrawnTurf}
              stats={selectedDrawnTurfStats}
              manifest={parcelManifest}
              onSelect={turf => {
                setSelectedDrawnTurfId(turf.id);
                zoomToDrawnTurf(turf);
              }}
              onRename={renameDrawnTurf}
              onDelete={deleteDrawnTurf}
              onCopy={copyDrawnTurfSummary}
              onExport={exportDrawnTurfCsv}
            />
          ) : (
            <CanvassDecisionPanel
              area={canvassArea}
              parcelRadiusCount={parcelRadiusCount}
              parcelStatus={parcelStatus}
              crewSize={canvassCrewSize}
              shiftHours={canvassShiftHours}
              selectedGid={selectedGid}
              onSelectZone={gid => {
                setSelectedGid(gid);
                zoomToFeature(gid);
              }}
              onCopy={copyCanvassPlan}
              onExport={exportCanvassCsv}
            />
          )}
          {showParcelDots ? (
            <div className="absolute bottom-5 left-14 z-[500] max-w-[min(360px,calc(100%-5rem))] border border-border bg-card/95 p-3 text-xs shadow-xl backdrop-blur">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="font-black uppercase text-primary">House Dots</h3>
                <span className="text-muted-foreground">{parcelStatus}</span>
              </div>
              <ParcelDotLegend manifest={parcelManifest} />
            </div>
          ) : null}
          <MapLegend layer={activeLayer} field={activeLayerField} geojson={filteredGeojson} />
        </div>
      </CardContent>
    </Card>
  );
}

function LayerChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Button type="button" size="sm" variant={active ? "default" : "secondary"} className="shadow-lg" onClick={onClick}>
      {label}
    </Button>
  );
}

function CanvassDecisionPanel(props: {
  area: CanvassArea | null;
  parcelRadiusCount: number;
  parcelStatus: string;
  crewSize: string;
  shiftHours: string;
  selectedGid: string;
  onSelectZone: (gid: string) => void;
  onCopy: () => void;
  onExport: () => void;
}) {
  const selectedLimit = Math.max(1, Math.min(8, Math.round(number(props.crewSize) * number(props.shiftHours) / 2 || 4)));
  const visibleRecommendations = props.area?.recommendations.slice(0, selectedLimit) || [];
  return (
    <aside aria-label="Canvass decision panel" className="absolute bottom-3 left-3 right-3 z-[570] max-h-[44%] overflow-auto border border-border bg-card/95 p-4 shadow-2xl backdrop-blur lg:bottom-5 lg:left-auto lg:right-4 lg:top-24 lg:max-h-none lg:w-[400px]">
      {!props.area ? (
        <div className="flex min-h-80 flex-col justify-between gap-6">
          <div>
            <p className="text-xs font-black uppercase text-primary">Decision panel</p>
            <h3 className="mt-1 text-3xl font-black leading-tight">Start with an address.</h3>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">The map will zoom in, draw the editable radius, highlight nearby turfs, count loaded residential parcel dots, and rank the best zones for in-person canvassing.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Objective" value="ROI/hour" />
            <Metric label="Mode" value="In person" />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Badge variant={props.area.summary.decision === "Go" ? "default" : props.area.summary.decision === "Scout" ? "secondary" : "destructive"}>{props.area.summary.decision}</Badge>
              <h3 className="mt-2 text-2xl font-black leading-tight">{props.area.location.label}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{nf.format(props.area.radiusMiles)} mi radius · {props.area.summary.turfCount} local block groups{props.area.usedFallback ? " · nearest available turfs" : ""}</p>
            </div>
            <div className="text-right">
              <div className="text-xs font-black uppercase text-primary">Avg ROI</div>
              <div className="text-4xl font-black leading-none">{nf.format(props.area.summary.averageRoi)}</div>
            </div>
          </div>
          <p className="border-l-4 border-primary bg-muted/50 px-3 py-2 text-sm font-medium">{props.area.summary.decisionReason}</p>
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Households" value={whole.format(props.area.summary.households)} />
            <Metric label="House dots" value={whole.format(props.parcelRadiusCount)} />
            <Metric label="Donors" value={nf.format(props.area.summary.donors)} />
            <Metric label="Revenue" value={money.format(props.area.summary.revenue)} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Metric label="Fit" value={nf.format(props.area.summary.missionAlignment)} />
            <Metric label="Access" value={nf.format(props.area.summary.doorAccess)} />
            <Metric label="Risk" value={nf.format(props.area.summary.avoidPressure)} />
            <Metric label="Opposition" value={nf.format(props.area.summary.oppositionRisk)} />
            <Metric label="Confidence" value={nf.format(props.area.summary.dataConfidence)} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <div className="border border-border p-3">
              <div className="text-xs font-black uppercase text-muted-foreground">Best fit</div>
              <div className="font-black">{props.area.summary.strongestTarget.label}</div>
              <div className="text-sm text-muted-foreground">{nf.format(props.area.summary.strongestTarget.score)}</div>
            </div>
            <div className="border border-border p-3">
              <div className="text-xs font-black uppercase text-muted-foreground">Main risk</div>
              <div className="font-black">{props.area.summary.strongestAvoid.label}</div>
              <div className="text-sm text-muted-foreground">{nf.format(props.area.summary.strongestAvoid.score)}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <span>{props.parcelStatus}</span>
            <span>Parcel dots are privacy-safe residential parcel context, not exact household records.</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={props.onCopy}>
              <Clipboard data-icon="inline-start" />Copy
            </Button>
            <Button variant="secondary" onClick={props.onExport}>
              <Download data-icon="inline-start" />CSV
            </Button>
          </div>
          <Separator />
          <div>
            <h4 className="mb-2 font-black uppercase text-primary">Ranked zones</h4>
            <div className="flex flex-col gap-2">
              {visibleRecommendations.map(item => (
                <CanvassZoneButton
                  key={rowKey(item.row)}
                  item={item}
                  selected={props.selectedGid === rowKey(item.row)}
                  onSelect={() => props.onSelectZone(rowKey(item.row))}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

function CustomTurfPanel(props: {
  turfs: DrawnTurf[];
  selectedTurf: DrawnTurf | null;
  stats: DrawnTurfStats | null;
  manifest: ParcelTileManifest | null;
  onSelect: (turf: DrawnTurf) => void;
  onRename: (turfId: string, name: string) => void;
  onDelete: (turfId: string) => void;
  onCopy: () => void;
  onExport: () => void;
}) {
  const topHousing = props.stats ? topHousingTypes(props.stats, props.manifest).slice(0, 8) : [];
  const hardHouseCount = props.stats?.housingTotal ?? 0;
  const houseDotsLabel = props.stats
    ? hardHouseCount > 0 || !props.stats.loadingHousing
      ? whole.format(hardHouseCount)
      : "Loading"
    : "0";
  const householdsLabel = props.stats
    ? hardHouseCount > 0
      ? whole.format(hardHouseCount)
      : whole.format(props.stats.households)
    : "0";
  return (
    <aside aria-label="Custom turf panel" className="absolute bottom-3 left-3 right-3 z-[570] max-h-[44%] overflow-auto border border-border bg-card/95 p-4 shadow-2xl backdrop-blur lg:bottom-5 lg:left-auto lg:right-4 lg:top-24 lg:max-h-none lg:w-[400px]">
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-xs font-black uppercase text-primary">Custom turfs</p>
          <h3 className="mt-1 text-3xl font-black leading-tight">{props.selectedTurf?.name || "Draw a turf."}</h3>
          <p className="mt-2 text-sm text-muted-foreground">Right-click places turf points. Left mouse drag still moves the map.</p>
        </div>
        {props.turfs.length ? (
          <div className="flex flex-col gap-2">
            {props.turfs.map(turf => (
              <Button key={turf.id} type="button" variant={props.selectedTurf?.id === turf.id ? "secondary" : "ghost"} className="h-auto justify-start p-2 text-left" onClick={() => props.onSelect(turf)}>
                <span className="grid w-full gap-1">
                  <span className="font-black">{turf.name}</span>
                  <span className="text-xs text-muted-foreground">{turf.points.length} points · {whole.format(props.selectedTurf?.id === turf.id && props.stats ? props.stats.housingTotal : 0)} house dots selected</span>
                </span>
              </Button>
            ))}
          </div>
        ) : (
          <p className="border border-border bg-muted/40 p-3 text-sm font-medium text-muted-foreground">No saved turfs yet. Right-click at least three points, then finish the turf.</p>
        )}
        {props.selectedTurf && props.stats ? (
          <Fragment>
            <Separator />
            <Input value={props.selectedTurf.name} onChange={event => props.onRename(props.selectedTurf?.id || "", event.target.value)} aria-label="Turf name" />
            <div className="grid grid-cols-2 gap-2">
              <Metric label="Block groups" value={whole.format(props.stats.blockGroups)} />
              <Metric label="House dots" value={houseDotsLabel} />
              <Metric label="Households" value={householdsLabel} />
              <Metric label="Revenue" value={money.format(props.stats.revenue)} />
              <Metric label="Priority" value={nf.format(props.stats.averagePriority)} />
              <Metric label="Mission fit" value={nf.format(props.stats.missionAlignment)} />
              <Metric label="Door access" value={nf.format(props.stats.doorAccess)} />
              <Metric label="Avoid" value={nf.format(props.stats.avoidPressure)} />
            </div>
            {props.stats.tooLargeForParcels ? (
              <p className="border border-border bg-muted/40 p-3 text-sm font-medium text-muted-foreground">This turf is too large for a parcel dot summary. Demographic stats are still shown.</p>
            ) : null}
            <div>
              <h4 className="mb-2 font-black uppercase text-primary">House Types</h4>
              <div className="flex flex-col gap-2">
                {topHousing.length ? topHousing.map(item => (
                  <div key={item.key} className="grid grid-cols-[1fr_auto] gap-3 text-sm">
                    <span className="flex items-center gap-2">
                      <span className="size-2.5 rounded-full border border-foreground/15" style={{ background: item.color }} />
                      {item.label}
                    </span>
                    <span className="tabular-nums">{whole.format(item.count)} · {nf.format(item.share)}%</span>
                  </div>
                )) : <p className="text-sm text-muted-foreground">{props.stats.loadingHousing ? "Counting parcel dots..." : "No house dots inside this turf."}</p>}
              </div>
            </div>
            <div>
              <h4 className="mb-2 font-black uppercase text-primary">Demographics</h4>
              <div className="grid gap-2">
                {props.stats.demographics.map(item => (
                  <div key={item.label} className="flex items-center justify-between gap-3 border border-border bg-muted/30 p-2 text-sm">
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className="font-medium tabular-nums">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={props.onCopy}>
                <Clipboard data-icon="inline-start" />Copy
              </Button>
              <Button variant="secondary" onClick={props.onExport}>
                <Download data-icon="inline-start" />CSV
              </Button>
              <Button variant="ghost" onClick={() => props.onDelete(props.selectedTurf?.id || "")}>
                <Trash2 data-icon="inline-start" />Delete
              </Button>
            </div>
          </Fragment>
        ) : null}
      </div>
    </aside>
  );
}

function CanvassZoneButton({ item, selected, onSelect }: { item: PlannerRecommendation; selected: boolean; onSelect: () => void }) {
  const row = item.row;
  return (
    <Button type="button" variant={selected ? "secondary" : "ghost"} className="h-auto justify-start overflow-hidden p-3 text-left whitespace-normal" onClick={onSelect}>
      <span className="grid w-full min-w-0 gap-2">
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block truncate font-black">#{item.rank} {row.display_location || row.GIDBG}</span>
            <span className="block text-xs text-muted-foreground">{row.municipality_name} · {item.distance !== undefined ? `${nf.format(item.distance)} mi` : "distance n/a"}</span>
          </span>
          <Badge className="shrink-0" variant={item.action === "Canvass now" ? "default" : item.action === "Scout access first" ? "secondary" : "outline"}>{shortActionLabel(item.action)}</Badge>
        </span>
        <span className="grid grid-cols-3 gap-2 text-xs">
          <span><strong>{formatCellValue("estimated_canvassable_households", row.estimated_canvassable_households)}</strong><br />households</span>
          <span><strong>{formatCellValue("mission_alignment_index", row.mission_alignment_index)}</strong><br />fit</span>
          <span><strong>{formatCellValue("door_access_index", row.door_access_index)}</strong><br />access</span>
        </span>
        <span className="text-xs font-medium text-muted-foreground">{item.messaging}</span>
      </span>
    </Button>
  );
}

function shortActionLabel(action: PlannerRecommendation["action"]) {
  if (action === "Canvass now") return "Canvass";
  if (action === "Scout access first") return "Scout";
  if (action === "Mail/digital follow-up") return "Mail/Digital";
  return "Skip";
}

function ParcelDotLegend({ manifest }: { manifest: ParcelTileManifest | null }) {
  const housingTypes = manifest?.housing_types ?? fallbackParcelHousingTypes;
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
      {Object.entries(housingTypes).map(([key, item]) => (
        <div key={key} className="flex items-center gap-2">
          <span className="size-2.5 rounded-full border border-foreground/15" style={{ background: item.color }} />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function MapLegend({ layer, field, geojson }: { layer: MapLayerDefinition; field: string; geojson: GeoJsonCollection | null }) {
  const palette = mapPalettes[layer.palette] || mapPalettes.score;
  const stats = geojson ? mapLayerStats(field, geojson) : null;
  const labels = stats && stats.max !== stats.min
    ? palette.map((_, index) => stats.min + ((stats.max - stats.min) / (palette.length - 1)) * index)
    : [0, 25, 50, 75, 100];
  return (
    <div className="absolute bottom-5 right-4 z-[500] border border-border bg-card/95 p-3 text-xs shadow-xl backdrop-blur">
      <h3 className="mb-1 font-black uppercase text-primary">{layer.label}</h3>
      <div className="flex flex-col gap-1">
        {palette.map((color, index) => (
          <div key={color} className="flex items-center gap-2">
            <span className="h-3 w-5 border border-border" style={{ background: color }} />
            <span>{formatMapValue(labels[index], layer)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildCanvassAreaFromLocation(location: PredictionLocation, rows: TurfRow[], primaryScoreCol: string, radius: number): CanvassArea {
  const safeRadius = Math.max(0.1, radius || 1);
  const candidates = rows
    .map(row => {
      const rowCenter = rowLocation(row);
      return rowCenter ? { row, distance: distanceMiles(location.lat, location.lon, rowCenter.lat, rowCenter.lon) } : null;
    })
    .filter(Boolean) as Array<{ row: TurfRow; distance: number }>;
  candidates.sort((a, b) => a.distance - b.distance);
  const withinRadius = candidates.filter(item => item.distance <= safeRadius);
  const source = withinRadius.length ? withinRadius : candidates.slice(0, 24);
  const recommendations = rankPlannerRows(source.map(item => item.row), new Map(source.map(item => [rowKey(item.row), item.distance])), primaryScoreCol).slice(0, 12);
  return {
    location,
    radiusMiles: safeRadius,
    usedFallback: !withinRadius.length,
    recommendations,
    summary: summarizeCanvassArea(source, recommendations, primaryScoreCol),
  };
}

function summarizeCanvassArea(source: Array<{ row: TurfRow; distance: number }>, recommendations: PlannerRecommendation[], primaryScoreCol: string): CanvassSummary {
  const rows = source.map(item => item.row);
  const households = rows.reduce((sum, row) => sum + firstFinite(row.estimated_canvassable_households, row.raw_occupied_households, 0), 0);
  const donors = rows.reduce((sum, row) => sum + firstFinite(row.estimated_donors, 0), 0);
  const revenue = rows.reduce((sum, row) => sum + firstFinite(row.estimated_revenue, 0), 0);
  const averageRoi = weightedAverageField(rows, primaryScoreCol);
  const doorAccess = weightedAverageField(rows, "door_access_index");
  const missionAlignment = weightedAverageField(rows, "mission_alignment_index");
  const oppositionRisk = weightedAverageField(rows, "opposition_risk_index");
  const avoidPressure = weightedAverageField(rows, "avoid_pressure_index");
  const dataConfidence = weightedAverageField(rows, "data_confidence_index");
  const strongestTarget = strongestWeightedProfile(rows, [
    ["target_affluent_educated_older_index", "Affluent older"],
    ["target_major_donor_index", "Major donor"],
    ["target_professional_family_index", "Professional family"],
    ["target_young_urban_professional_index", "Young urban"],
  ]);
  const strongestAvoid = strongestWeightedProfile(rows, [
    ["avoid_economic_stress_index", "Economic stress"],
    ["avoid_transient_renter_index", "Transient renters"],
    ["apartment_density_index", "Apartment density"],
  ]);
  const topAction = recommendations[0]?.action;
  const decision: CanvassDecision = averageRoi >= 72 && doorAccess >= 58 && avoidPressure < 75
    ? "Go"
    : dataConfidence < 58 || doorAccess < 58 || averageRoi >= 60 || topAction !== "Skip today"
      ? "Scout"
      : "Skip";
  const decisionReason = decision === "Go"
    ? "Strong ROI, enough door access, and manageable avoid pressure for in-person canvassing."
    : decision === "Scout"
      ? "The area has useful potential, but access, data confidence, or housing mix should be checked before assigning a full crew."
      : "The nearby zones are lower-return for in-person canvassing today; use mail, digital, or choose another address.";
  return {
    decision,
    decisionReason,
    turfCount: rows.length,
    households,
    donors,
    revenue,
    averageRoi,
    doorAccess,
    missionAlignment,
    oppositionRisk,
    avoidPressure,
    dataConfidence,
    strongestTarget,
    strongestAvoid,
  };
}

function weightedAverageField(rows: TurfRow[], field: string) {
  const weighted = rows.reduce((state, row) => {
    const value = firstFinite(row[field]);
    if (!Number.isFinite(value)) return state;
    const weight = Math.max(1, firstFinite(row.estimated_canvassable_households, row.raw_occupied_households, 1));
    return { value: state.value + value * weight, weight: state.weight + weight };
  }, { value: 0, weight: 0 });
  return weighted.weight ? weighted.value / weighted.weight : 0;
}

function strongestWeightedProfile(rows: TurfRow[], profiles: ReadonlyArray<readonly [string, string]>) {
  return profiles
    .map(([field, label]) => ({ label, score: weightedAverageField(rows, field) }))
    .sort((a, b) => b.score - a.score)[0] ?? { label: "n/a", score: 0 };
}

function rankPlannerRows(rows: TurfRow[], distances = new Map<string, number>(), primaryScoreCol = "overall_score"): PlannerRecommendation[] {
  return rows
    .map(row => {
      const score = plannerScore(row, distances.get(rowKey(row)), primaryScoreCol);
      return {
        row,
        rank: 0,
        score,
        distance: distances.get(rowKey(row)),
        action: plannerAction(row, score),
        rationale: plannerRationale(row),
        messaging: plannerMessaging(row),
      };
    })
    .filter(item => Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function plannerScore(row: TurfRow, distance?: number, primaryScoreCol = "overall_score") {
  const base = firstFinite(row.map_priority_index, row[primaryScoreCol], row.overall_score, row.election_adjusted_score, row.contribution_likelihood_score, 0);
  const access = firstFinite(row.door_access_index, row.logistics_score, 50);
  const households = firstFinite(row.estimated_canvassable_households, row.raw_occupied_households, 0);
  const revenue = firstFinite(row.estimated_revenue, 0);
  const missionAlignment = firstFinite(row.mission_alignment_index, 50);
  const oppositionRisk = firstFinite(row.opposition_risk_index, 0);
  const avoid = firstFinite(row.avoid_pressure_index, 0);
  const confidence = firstFinite(row.data_confidence_index, row.data_quality_score, 70);
  const householdBonus = Math.min(10, households / 80);
  const revenueBonus = Math.min(8, revenue / 180);
  const missionBonus = (missionAlignment - 50) * 0.08;
  const oppositionPenalty = Math.max(0, oppositionRisk - 65) * 0.05;
  const accessBonus = (access - 55) * 0.16;
  const avoidPenalty = Math.max(0, avoid - 55) * 0.18;
  const confidencePenalty = Math.max(0, 60 - confidence) * 0.22;
  const distancePenalty = distance === undefined ? 0 : Math.max(0, distance - 1.5) * 1.5;
  return Math.max(0, Math.min(100, base + householdBonus + revenueBonus + missionBonus + accessBonus - oppositionPenalty - avoidPenalty - confidencePenalty - distancePenalty));
}

function plannerAction(row: TurfRow, score: number): PlannerRecommendation["action"] {
  const access = firstFinite(row.door_access_index, row.logistics_score, 50);
  const avoid = firstFinite(row.avoid_pressure_index, 0);
  const confidence = firstFinite(row.data_confidence_index, row.data_quality_score, 70);
  const apartments = firstFinite(row.apartment_density_index, 0);
  if (confidence < 50 || (apartments >= 72 && access < 68)) return "Scout access first";
  if (score >= 78 && access >= 58 && avoid < 75) return "Canvass now";
  if (score < 50 || avoid >= 82) return "Skip today";
  return "Mail/digital follow-up";
}

function plannerRationale(row: TurfRow) {
  const profile = strongestPlannerProfile(row);
  const reasons = [
    `Target fit: ${profile.label} at ${nf.format(profile.score)}.`,
    `Mission fit ${formatCellValue("mission_alignment_index", row.mission_alignment_index)} with opposition risk ${formatCellValue("opposition_risk_index", row.opposition_risk_index)}.`,
    `Door access ${formatCellValue("door_access_index", row.door_access_index)} with ${formatCellValue("estimated_canvassable_households", row.estimated_canvassable_households)} estimated canvassable households.`,
    `Revenue upside ${formatCellValue("estimated_revenue", row.estimated_revenue)} with avoid pressure ${formatCellValue("avoid_pressure_index", row.avoid_pressure_index)}.`,
  ];
  const confidence = firstFinite(row.data_confidence_index, row.data_quality_score, 0);
  if (confidence < 60) reasons.push(`Data confidence is only ${nf.format(confidence)}, so validate before assigning a full crew.`);
  return reasons;
}

function plannerMessaging(row: TurfRow) {
  const profile = strongestPlannerProfile(row).column;
  if (profile === "target_major_donor_index") return "Lead with institutional impact, trusted journalism, and long-term stewardship.";
  if (profile === "target_professional_family_index") return "Lead with local journalism, education, and family programming.";
  if (profile === "target_young_urban_professional_index") return "Lead with independent journalism, civic impact, and simple mobile signup.";
  return "Lead with trusted journalism, educational programming, arts, culture, and civic responsibility.";
}

function strongestPlannerProfile(row: TurfRow) {
  const profiles = [
    ["target_affluent_educated_older_index", "Affluent older public-media fit"],
    ["target_major_donor_index", "Major donor upside"],
    ["target_professional_family_index", "Professional family fit"],
    ["target_young_urban_professional_index", "Young professional fit"],
  ] as const;
  const [column, label] = profiles
    .map(([profileColumn, profileLabel]) => [profileColumn, profileLabel, number(row[profileColumn])] as const)
    .sort((a, b) => b[2] - a[2])[0];
  return { column, label, score: Number.isFinite(number(row[column])) ? number(row[column]) : 0 };
}

function firstFinite(...values: unknown[]) {
  for (const value of values) {
    const parsed = number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function csvEscape(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "plan";
}

function readSavedState(): SavedState {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(storageKey) || "{}") as SavedState;
  } catch {
    return {};
  }
}

function readDrawnTurfs(): DrawnTurf[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(drawnTurfStorageKey) || "[]") as DrawnTurf[];
    return Array.isArray(parsed)
      ? parsed.filter(turf => turf.id && turf.name && Array.isArray(turf.points) && turf.points.length >= 3)
      : [];
  } catch {
    return [];
  }
}

function parseCsv(text: string) {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      out.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    out.push(row);
  }
  return out;
}

function detectNumericColumns(headers: string[], rows: TurfRow[]) {
  const numeric = new Set<string>();
  headers.forEach(header => {
    const sample = rows.slice(0, 200).map(row => row[header]).filter(Boolean);
    if (sample.length && sample.every(value => Number.isFinite(Number(value)))) numeric.add(header);
  });
  ["average_score", "median_score", "turf_count"].forEach(column => numeric.add(column));
  return numeric;
}

function computeColumnStats(headers: string[], rows: TurfRow[], numericColumns: Set<string>) {
  const stats = new Map<string, ColumnStats>();
  headers.forEach(header => {
    if (!numericColumns.has(header)) return;
    const values = rows.map(row => Number(row[header])).filter(Number.isFinite);
    if (!values.length) return;
    const total = values.reduce((sum, value) => sum + value, 0);
    stats.set(header, { average: total / values.length, min: Math.min(...values), max: Math.max(...values) });
  });
  return stats;
}

function aggregateMunicipalities(rows: TurfRow[], headers: string[], primaryScoreCol: string) {
  const groups = new Map<string, TurfRow[]>();
  rows.forEach(row => {
    const municipality = row.municipality_name || "Unknown municipality";
    const county = row.County_name || "";
    const key = `${municipality}::${county}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  });
  return [...groups.values()].map(groupRows => {
    const scores = groupRows.map(row => primaryScore(row, primaryScoreCol)).filter(Number.isFinite).sort((a, b) => a - b);
    const output: TurfRow = {
      municipality_name: groupRows[0].municipality_name || "Unknown municipality",
      County_name: unique(groupRows.map(row => row.County_name)).join(", "),
      turf_count: String(groupRows.length),
      average_score: String(average(scores)),
      median_score: String(median(scores)),
    };
    headers.forEach(header => {
      const values = groupRows.map(row => row[header]).filter(Boolean);
      if (sumColumns.has(header)) output[header] = String(values.reduce((sumValue, value) => sumValue + number(value), 0));
      else if (!output[header] && values.length) output[header] = unique(values).slice(0, 3).join(", ");
    });
    return output;
  });
}

function parseCoordinates(value: string): PredictionLocation | null {
  const match = value.trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, label: `${lat}, ${lon}` };
}

async function geocodeAddress(query: string): Promise<PredictionLocation | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("viewbox", "-73.508,42.886,-69.858,41.187");
  url.searchParams.set("bounded", "1");
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Geocoding request failed.");
  const results = await response.json() as Array<{ lat: string; lon: string; display_name: string }>;
  const result = results[0];
  return result ? { lat: Number(result.lat), lon: Number(result.lon), label: result.display_name } : null;
}

function nearestMapFeature(location: PredictionLocation, geojson: GeoJsonCollection) {
  return geojson.features.reduce<{ feature: GeoJsonFeature; distance: number } | null>((nearest, feature) => {
    const center = mapFeatureLocation(feature);
    if (!center) return nearest;
    const distance = distanceMiles(location.lat, location.lon, center.lat, center.lon);
    return !nearest || distance < nearest.distance ? { feature, distance } : nearest;
  }, null);
}

function rowLocation(row: TurfRow) {
  const lat = number(row.location_latitude);
  const lon = number(row.location_longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

function featureGid(properties: Record<string, unknown> | undefined) {
  return String(properties?.GIDBG || properties?.GEOID || "");
}

function pointFeatureWithinRadius(feature: GeoJsonFeature, location: PredictionLocation, radiusMiles: number) {
  if (feature.geometry.type !== "Point") return false;
  const [lon, lat] = feature.geometry.coordinates;
  return Number.isFinite(lat) && Number.isFinite(lon) && distanceMiles(location.lat, location.lon, lat, lon) <= radiusMiles;
}

function pointFeatureInsideTurf(feature: GeoJsonFeature, turf: DrawnTurf) {
  if (feature.geometry.type !== "Point") return false;
  const [lon, lat] = feature.geometry.coordinates;
  return pointInPolygon({ lat, lon }, turf.points);
}

function countTurfHousingFromTiles(turf: DrawnTurf, tileKeys: string[], tileCache: Map<string, GeoJsonCollection>) {
  return countTurfHousingFromTileList(turf, tileKeys.map(key => tileCache.get(key) ?? null));
}

function countTurfHousingFromTileList(turf: DrawnTurf, tiles: Array<GeoJsonCollection | null>) {
  const counts: Record<string, number> = {};
  let total = 0;
  tiles.forEach(tile => {
    tile?.features.forEach(feature => {
      if (!pointFeatureInsideTurf(feature, turf)) return;
      const type = String(feature.properties?.housing_type || "residential_other");
      counts[type] = (counts[type] || 0) + 1;
      total += 1;
    });
  });
  return { counts, total };
}

function summarizeDrawnTurf(
  turf: DrawnTurf,
  geojson: GeoJsonCollection,
  primaryScoreCol: string,
  housingCounts: Record<string, number>,
  housingTotal: number,
  loadingHousing: boolean,
  tooLargeForParcels: boolean,
): DrawnTurfStats {
  const features = geojson.features.filter(feature => featureTouchesTurf(feature, turf));
  const rows = features.map(feature => feature.properties as TurfRow);
  const households = rows.reduce((sum, row) => sum + firstFinite(row.estimated_canvassable_households, row.raw_occupied_households, 0), 0);
  const donors = rows.reduce((sum, row) => sum + firstFinite(row.estimated_donors, 0), 0);
  const revenue = rows.reduce((sum, row) => sum + firstFinite(row.estimated_revenue, 0), 0);
  const demographicFields = [
    ["Owner occupied", "raw_owner_occupied_share"],
    ["Renter occupied", "renter_occupied_share"],
    ["College degree", "raw_college_share"],
    ["Age 45+", "raw_age_45_plus_share"],
    ["Age 25-44", "age_25_44_share"],
    ["Families", "family_household_share"],
    ["Single-person households", "single_person_household_share"],
    ["Children at home", "households_with_children_share"],
    ["Spanish language", "spanish_language_share"],
    ["Limited English", "limited_english_share"],
    ["Foreign born", "foreign_born_share"],
    ["Median income", "raw_median_household_income"],
    ["Median home value", "raw_median_house_value"],
  ] as const;
  return {
    blockGroups: rows.length,
    households,
    donors,
    revenue,
    averagePriority: weightedAverageField(rows, primaryScoreCol),
    missionAlignment: weightedAverageField(rows, "mission_alignment_index"),
    doorAccess: weightedAverageField(rows, "door_access_index"),
    avoidPressure: weightedAverageField(rows, "avoid_pressure_index"),
    oppositionRisk: weightedAverageField(rows, "opposition_risk_index"),
    dataConfidence: weightedAverageField(rows, "data_confidence_index"),
    demographics: demographicFields.map(([label, field]) => ({ label, value: formatCellValue(field, weightedAverageField(rows, field)) })),
    housingCounts,
    housingTotal,
    loadingHousing,
    tooLargeForParcels,
  };
}

function featureTouchesTurf(feature: GeoJsonFeature, turf: DrawnTurf) {
  const center = mapFeatureLocation(feature);
  if (center && pointInPolygon(center, turf.points)) return true;
  const featurePoints = geometryPoints(feature.geometry);
  if (featurePoints.some(point => pointInPolygon(point, turf.points))) return true;
  return turf.points.some(point => pointInGeometry(point, feature.geometry));
}

function turfTileKeys(turf: DrawnTurf, zoom: number) {
  const bounds = turfBounds(turf);
  if (!bounds) return [];
  const northWest = lonlatToTile(bounds.west, bounds.north, zoom);
  const southEast = lonlatToTile(bounds.east, bounds.south, zoom);
  const keys: string[] = [];
  for (let x = northWest.x; x <= southEast.x; x += 1) {
    for (let y = northWest.y; y <= southEast.y; y += 1) {
      keys.push(`${zoom}/${x}/${y}`);
    }
  }
  return keys;
}

function turfBounds(turf: DrawnTurf) {
  if (!turf.points.length) return null;
  return turf.points.reduce((bounds, point) => ({
    north: Math.max(bounds.north, point.lat),
    south: Math.min(bounds.south, point.lat),
    east: Math.max(bounds.east, point.lon),
    west: Math.min(bounds.west, point.lon),
  }), { north: -90, south: 90, east: -180, west: 180 });
}

function pointInPolygon(point: TurfPoint, polygon: TurfPoint[]) {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].lon;
    const yi = polygon[i].lat;
    const xj = polygon[j].lon;
    const yj = polygon[j].lat;
    const intersects = ((yi > point.lat) !== (yj > point.lat))
      && point.lon < ((xj - xi) * (point.lat - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInGeometry(point: TurfPoint, geometry: GeoJSON.Geometry): boolean {
  if (geometry.type === "Polygon") return geometry.coordinates.some(ring => pointInPolygon(point, ring.map(([lon, lat]) => ({ lon, lat }))));
  if (geometry.type === "MultiPolygon") return geometry.coordinates.some(polygon => polygon.some(ring => pointInPolygon(point, ring.map(([lon, lat]) => ({ lon, lat })))));
  if (geometry.type === "GeometryCollection") return geometry.geometries.some(item => pointInGeometry(point, item));
  return false;
}

function geometryPoints(geometry: GeoJSON.Geometry) {
  const pairs: TurfPoint[] = [];
  collectCoordinatePairs((geometry as { coordinates?: unknown }).coordinates, pairs);
  if (geometry.type === "GeometryCollection") {
    geometry.geometries.forEach(item => pairs.push(...geometryPoints(item)));
  }
  return pairs;
}

function topHousingTypes(stats: DrawnTurfStats, manifest: ParcelTileManifest | null) {
  const housingTypes = manifest?.housing_types ?? fallbackParcelHousingTypes;
  return Object.entries(stats.housingCounts)
    .map(([key, count]) => {
      const item = housingTypes[key] ?? fallbackParcelHousingTypes.residential_other;
      return {
        key,
        count,
        label: item.label,
        color: item.color,
        share: stats.housingTotal ? (count / stats.housingTotal) * 100 : 0,
      };
    })
    .sort((a, b) => b.count - a.count);
}

function customTurfColor(index: number) {
  const colors = ["#287c71", "#ad40d9", "#df9b2f", "#c2477f", "#5b5bd6", "#d9004b"];
  return colors[index % colors.length];
}

function mapFeatureLocation(feature: GeoJsonFeature) {
  const properties = feature.properties || {};
  const lat = firstFiniteOptional(properties.location_latitude, properties.INTPTLAT, properties.lat, properties.latitude);
  const lon = firstFiniteOptional(properties.location_longitude, properties.INTPTLON, properties.lon, properties.lng, properties.longitude);
  if (lat !== undefined && lon !== undefined) return { lat, lon };
  return geometryLocation(feature.geometry);
}

function geometryLocation(geometry: GeoJSON.Geometry) {
  const pairs: Array<{ lat: number; lon: number }> = [];
  if (geometry.type === "GeometryCollection") {
    geometry.geometries.forEach(item => collectCoordinatePairs((item as { coordinates?: unknown }).coordinates, pairs));
  } else {
    collectCoordinatePairs((geometry as { coordinates?: unknown }).coordinates, pairs);
  }
  if (!pairs.length) return null;
  const totals = pairs.reduce((state, pair) => ({ lat: state.lat + pair.lat, lon: state.lon + pair.lon }), { lat: 0, lon: 0 });
  return { lat: totals.lat / pairs.length, lon: totals.lon / pairs.length };
}

function collectCoordinatePairs(value: unknown, pairs: Array<{ lat: number; lon: number }>) {
  if (!Array.isArray(value)) return;
  if (typeof value[0] === "number" && typeof value[1] === "number") {
    pairs.push({ lon: value[0], lat: value[1] });
    return;
  }
  value.forEach(item => collectCoordinatePairs(item, pairs));
}

function firstFiniteOptional(...values: unknown[]) {
  for (const value of values) {
    const parsed = number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function distanceMiles(aLat: number, aLon: number, bLat: number, bLon: number) {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = toRadians(bLat - aLat);
  const dLon = toRadians(bLon - aLon);
  const lat1 = toRadians(aLat);
  const lat2 = toRadians(bLat);
  const haversine = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusMiles * Math.asin(Math.sqrt(haversine));
}

function visibleParcelTileKeys(map: LeafletMap, zoom: number) {
  const bounds = map.getBounds();
  const northWest = lonlatToTile(bounds.getWest(), bounds.getNorth(), zoom);
  const southEast = lonlatToTile(bounds.getEast(), bounds.getSouth(), zoom);
  const keys: string[] = [];
  for (let x = northWest.x; x <= southEast.x; x += 1) {
    for (let y = northWest.y; y <= southEast.y; y += 1) {
      keys.push(`${zoom}/${x}/${y}`);
    }
  }
  return keys;
}

function lonlatToTile(lon: number, lat: number, zoom: number) {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const scale = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * scale);
  const latRad = clampedLat * Math.PI / 180;
  const y = Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * scale);
  return {
    x: Math.max(0, Math.min(scale - 1, x)),
    y: Math.max(0, Math.min(scale - 1, y)),
  };
}

function parcelDotStyle(feature: GeoJsonFeature, manifest: ParcelTileManifest): CircleMarkerOptions {
  const type = String(feature.properties?.housing_type || "residential_other");
  const housingType = manifest.housing_types[type] ?? fallbackParcelHousingTypes.residential_other;
  return {
    radius: 4,
    color: "#ffffff",
    weight: 0.8,
    opacity: 0.9,
    fillColor: housingType.color,
    fillOpacity: 0.82,
  };
}

function parcelTooltipHtml(properties: Record<string, unknown>) {
  return `<strong>${escapeHtml(String(properties.housing_type_label || "Residential parcel"))}</strong><br>${escapeHtml(String(properties.value_band || "value unknown"))}`;
}

function parcelPopupHtml(properties: Record<string, unknown>) {
  const rows = [
    ["Housing type", String(properties.housing_type_label || "Residential other")],
    ["Units", String(properties.units_bucket || "unknown")],
    ["Assessed value", String(properties.value_band || "unknown")],
    ["Year built", String(properties.year_built_decade || "unknown")],
    ["Style", String(properties.style || "")],
    ["Assessor records", String(properties.assessor_record_count || "")],
  ].filter(([, value]) => value);
  return `<dl class="grid gap-2 text-sm">${rows.map(([label, value]) => `<div><dt class="font-semibold">${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>`;
}

function mapFeatureStyle(feature: GeoJsonFeature, layer: MapLayerDefinition, field: string, geojson: GeoJsonCollection, preset: MapPreset | null, canvassArea: CanvassArea | null, selectedGid: string, turfMode = false): PathOptions {
  const properties = feature.properties || {};
  const matchesPreset = !preset || preset.test(properties);
  if (canvassArea) {
    const gid = featureGid(properties);
    const center = mapFeatureLocation(feature);
    const distance = center ? distanceMiles(canvassArea.location.lat, canvassArea.location.lon, center.lat, center.lon) : Number.POSITIVE_INFINITY;
    const inRadius = distance <= canvassArea.radiusMiles;
    const recommendation = canvassArea.recommendations.find(item => rowKey(item.row) === gid);
    const isSelected = selectedGid === gid;
    return {
      color: isSelected ? "#f5de00" : recommendation ? "#361247" : inRadius ? "#732487" : "#6b7280",
      weight: isSelected ? 4 : recommendation ? 2.4 : inRadius ? 1.2 : 0.35,
      opacity: isSelected || recommendation ? 1 : inRadius ? 0.8 : 0.35,
      fillColor: getMapColor(mapValue(properties, field), layer, field, geojson),
      fillOpacity: isSelected ? 0.9 : recommendation ? 0.82 : inRadius ? 0.58 : 0.12,
    };
  }
  return {
    color: matchesPreset ? "#1f2937" : "#9ca3af",
    weight: matchesPreset ? 0.8 : 0.35,
    opacity: turfMode ? 0.28 : matchesPreset ? 0.65 : 0.3,
    fillColor: getMapColor(mapValue(properties, field), layer, field, geojson),
    fillOpacity: turfMode ? 0.18 : matchesPreset ? 0.78 : 0.12,
  };
}

function mapValue(properties: Record<string, unknown> | undefined, field: string) {
  return number(properties?.[field]);
}

function getMapColor(value: number, layer: MapLayerDefinition, field: string, geojson: GeoJsonCollection) {
  const palette = mapPalettes[layer.palette] || mapPalettes.score;
  if (!Number.isFinite(value)) return "#e5e7eb";
  const stats = mapLayerStats(field, geojson);
  const pct = stats.max === stats.min ? value / 100 : (value - stats.min) / (stats.max - stats.min);
  const index = Math.max(0, Math.min(palette.length - 1, Math.floor(pct * palette.length)));
  return palette[index];
}

function mapLayerStats(field: string, geojson: GeoJsonCollection) {
  const values = geojson.features.map(feature => mapValue(feature.properties, field)).filter(Number.isFinite);
  return values.length ? { min: Math.min(...values), max: Math.max(...values) } : { min: 0, max: 100 };
}

function mapStatusText(geojson: GeoJsonCollection | null, filteredGeojson: GeoJsonCollection | null, geographyPreset: string, canvassArea: CanvassArea | null) {
  const total = geojson?.features.length ?? 0;
  const visible = filteredGeojson?.features.length ?? 0;
  if (canvassArea) return `${whole.format(visible)} nearby block groups around the address; ${whole.format(canvassArea.summary.households)} canvassable households in the selected radius.`;
  if (!visible) return `${whole.format(total)} block groups loaded. Choose an area preset, county, or municipality to render the map.`;
  const prefix = geographyPreset ? `${mapGeographyPresetDefinitions[geographyPreset].label}: ` : "";
  return `${prefix}rendering ${whole.format(visible)} of ${whole.format(total)} block groups.`;
}

function municipalityLabel(properties: Record<string, unknown> | undefined) {
  return String(properties?.NAME || properties?.NAMELSAD || "Municipality");
}

function detectRawMapLayers(geojson: GeoJsonCollection): MapLayerDefinition[] {
  const fields = new Set<string>();
  geojson.features.slice(0, 100).forEach(feature => {
    Object.entries(feature.properties || {}).forEach(([key, value]) => {
      if (!mapLayerCatalog.some(layer => layer.field === key) && Number.isFinite(Number(value))) fields.add(key);
    });
  });
  return [...fields].sort().map(field => ({
    group: "Raw",
    field,
    label: labelize(field).replace(/^Raw /, ""),
    description: `Raw numeric field: ${field}`,
    format: moneyColumns.has(field) ? "money" as const : "number" as const,
    palette: "neutral" as const,
  }));
}

function mapTooltipHtml(properties: Record<string, unknown>, layer: MapLayerDefinition) {
  const title = String(properties.display_location || properties.municipality_name || properties.GIDBG || properties.GEOID || "Selected turf");
  return `<strong>${escapeHtml(title)}</strong><br>${escapeHtml(layer.label)}: ${escapeHtml(formatMapValue(mapValue(properties, layer.field), layer))}`;
}

function mapPopupHtml(properties: Record<string, unknown>, layer: MapLayerDefinition) {
  const usefulFields = ["display_location", "County_name", "municipality_name", "overall_tier", "score_tier", "election_adjusted_tier", "mission_alignment_index", "opposition_risk_index", "estimated_donors", "total_population"];
  const rows = [
    [layer.label, formatMapValue(mapValue(properties, layer.field), layer)],
    ...usefulFields.map(field => [labelize(field), String(properties[field] ?? "")]).filter(([, value]) => value),
  ];
  return `<dl class="grid gap-2 text-sm">${rows.map(([label, value]) => `<div><dt class="font-semibold">${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>`;
}

function formatMapValue(value: unknown, layer: MapLayerDefinition) {
  if (value === undefined || value === null || value === "") return "n/a";
  if (layer.format === "money") return money.format(number(value));
  if (layer.format === "percent") return `${nf.format(number(value))}%`;
  if (layer.format === "text") return String(value);
  return nf.format(number(value));
}

function primaryScoreColumn(headers: string[]) {
  return headers.includes("election_adjusted_score") ? "election_adjusted_score" : headers.includes("overall_score") ? "overall_score" : "score";
}

function primaryTierColumn(headers: string[]) {
  return headers.includes("election_adjusted_tier") ? "election_adjusted_tier" : headers.includes("overall_tier") ? "overall_tier" : "score_tier";
}

function primaryScore(row: TurfRow, primaryScoreCol: string) {
  return number(row[primaryScoreCol] ?? row.overall_score);
}

function renderAverageCell(column: string, rows: TurfRow[], numericColumns: Set<string>) {
  if (!numericColumns.has(column) && !["average_score", "median_score", "turf_count"].includes(column)) return <span className="text-muted-foreground">n/a</span>;
  const values = rows.map(row => number(row[column])).filter(Number.isFinite);
  if (!values.length) return <span className="text-muted-foreground">blank</span>;
  return formatColumnNumber(column, average(values));
}

function formatCellValue(column: string, value: unknown) {
  if (value === undefined || value === null || value === "") return "blank";
  const n = number(value);
  if (moneyColumns.has(column)) return Number.isFinite(n) ? money.format(n) : String(value);
  if (isPercentColumn(column)) return Number.isFinite(n) ? `${nf.format(n)}%` : String(value);
  if (Number.isFinite(n) && String(value).trim() !== "") return nf.format(n);
  return String(value);
}

function formatColumnNumber(column: string, value: number) {
  if (moneyColumns.has(column)) return money.format(value);
  if (isPercentColumn(column)) return `${nf.format(value)}%`;
  return nf.format(value);
}

function isPercentColumn(column: string) {
  return [...percentColumns].some(token => column.toLowerCase().includes(token));
}

function scoreTooltip(column: string, row: TurfRow) {
  if (!column.includes("score") && !column.includes("index")) return "";
  const fields = ["overall_score", "election_adjusted_score", "target_presence_index", "avoid_pressure_index", "data_confidence_index"]
    .filter(field => row[field]);
  return fields.map(field => `${labelize(field)}: ${formatCellValue(field, row[field])}`).join("\n");
}

function rowKey(row: TurfRow) {
  return row.GIDBG || row.GEOID || row.municipality_name || JSON.stringify(row).slice(0, 80);
}

function labelize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, match => match.toUpperCase());
}

function unique(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

function number(value: unknown) {
  if (value === null || value === undefined || value === "") return Number.NaN;
  return Number(value);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char] || char));
}



