"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  GeoJSON as LeafletGeoJSON,
  Layer as LeafletLayer,
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
  Layers,
  Loader2,
  MapPinned,
  Radio,
  RotateCcw,
  Search,
  Target,
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

type Neighbor = {
  row: TurfRow;
  distance: number;
  score: number;
};

type Prediction = {
  location: PredictionLocation;
  score: number;
  tier: string;
  neighbors: Neighbor[];
  usedFallback: boolean;
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
const storageKey = "gbhTurfExplorerState:v1";
const pageSize = 100;

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
  "estimated_donors",
  "estimated_revenue",
  "total_population",
];

const columnPresets: Record<string, string[]> = {
  overview: importantColumns,
  scores: [
    "GIDBG",
    "display_location",
    "overall_score",
    "election_adjusted_score",
    "map_priority_index",
    "target_presence_index",
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
  const [predictionQuery, setPredictionQuery] = useState("");
  const [radiusMiles, setRadiusMiles] = useState("1");
  const [neighborCount, setNeighborCount] = useState("8");
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [predicting, setPredicting] = useState(false);

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

  async function runPrediction() {
    const query = predictionQuery.trim();
    if (!query) return;
    setPredicting(true);
    try {
      const location = parseCoordinates(query) ?? await geocodeAddress(query);
      if (!location) throw new Error("No matching location found.");
      const next = predictFromLocation(location, rows, primaryScoreCol, Number(radiusMiles || 1), Number(neighborCount || 8));
      setPrediction(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Prediction failed.");
    } finally {
      setPredicting(false);
    }
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
        <div className="mx-auto grid max-w-[1800px] gap-6 px-5 py-8 md:grid-cols-[1fr_360px] md:px-12">
          <div>
            <div className="mb-4 flex items-center gap-3">
              <Badge className="bg-[#d90000] text-white"><Radio data-icon="inline-start" />Live data</Badge>
              <span className="font-bold text-[#c1afc9]">{loading ? "Loading scored Massachusetts block groups" : `${whole.format(rows.length)} turfs loaded`}</span>
            </div>
            <h1 className="max-w-4xl text-5xl font-black leading-[0.95] tracking-[-0.04em] md:text-7xl">GBH Turf Explorer</h1>
            <p className="mt-4 max-w-3xl text-xl font-medium leading-8 text-[#edd4f5]">Search, segment, map, and predict donor opportunity across Massachusetts with a dashboard that now follows GBH.org&apos;s purple, yellow, and media-forward system.</p>
          </div>
          <div className="rounded-none bg-[#5b1f68] p-7 shadow-2xl">
            <h2 className="text-3xl font-black leading-tight">Support the GBH field strategy.</h2>
            <p className="mt-3 text-lg leading-7 text-[#edd4f5]">Find priority communities, compare local signals, and focus outreach where membership momentum is strongest.</p>
          </div>
        </div>
      </section>

      <Tabs defaultValue="data" className="mx-auto flex max-w-[1800px] flex-col gap-5 px-5 py-6 md:px-12">
        <TabsList className="w-fit bg-white">
          <TabsTrigger value="data"><BarChart3 data-icon="inline-start" />Explorer</TabsTrigger>
          <TabsTrigger value="map"><MapPinned data-icon="inline-start" />Turf Map</TabsTrigger>
        </TabsList>

        <TabsContent value="data" className="flex flex-col gap-4">
          <SummaryGrid summary={summary} loading={loading} />
          <Card>
            <CardHeader>
              <CardTitle>Filters</CardTitle>
              <CardDescription>Search, segment, sort, and compare scored Massachusetts block groups.</CardDescription>
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

          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <PredictionPanel
              predictionQuery={predictionQuery}
              setPredictionQuery={setPredictionQuery}
              radiusMiles={radiusMiles}
              setRadiusMiles={value => {
                setRadiusMiles(value);
                if (prediction) setPrediction(predictFromLocation(prediction.location, rows, primaryScoreCol, Number(value || 1), Number(neighborCount || 8)));
              }}
              neighborCount={neighborCount}
              setNeighborCount={value => {
                setNeighborCount(value);
                if (prediction) setPrediction(predictFromLocation(prediction.location, rows, primaryScoreCol, Number(radiusMiles || 1), Number(value || 8)));
              }}
              prediction={prediction}
              predicting={predicting}
              onPredict={runPrediction}
            />
            <ScoreChart rows={filteredRows} primaryScoreCol={primaryScoreCol} />
          </div>

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

        <TabsContent value="map">
          <TurfMap />
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

function PredictionPanel(props: {
  predictionQuery: string;
  setPredictionQuery: (value: string) => void;
  radiusMiles: string;
  setRadiusMiles: (value: string) => void;
  neighborCount: string;
  setNeighborCount: (value: string) => void;
  prediction: Prediction | null;
  predicting: boolean;
  onPredict: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Location Prediction</CardTitle>
        <CardDescription>Enter an address or coordinates to estimate success from nearby scored turfs.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-[1fr_120px_120px_auto]">
          <LabeledControl label="Address or coordinates">
            <Input
              value={props.predictionQuery}
              onChange={event => props.setPredictionQuery(event.target.value)}
              onKeyDown={event => { if (event.key === "Enter") props.onPredict(); }}
              placeholder="10 Guest St, Boston, MA or 42.357,-71.061"
            />
          </LabeledControl>
          <LabeledControl label="Radius miles">
            <Input type="number" min="0.1" step="0.1" value={props.radiusMiles} onChange={event => props.setRadiusMiles(event.target.value)} />
          </LabeledControl>
          <LabeledControl label="Local turfs">
            <Input type="number" min="1" max="25" step="1" value={props.neighborCount} onChange={event => props.setNeighborCount(event.target.value)} />
          </LabeledControl>
          <div className="flex items-end">
            <Button onClick={props.onPredict} disabled={props.predicting}>
              {props.predicting ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Target data-icon="inline-start" />}
              Predict
            </Button>
          </div>
        </div>
        {props.prediction ? (
          <div className="grid gap-4 border border-border bg-[#f7f3fb] p-4 md:grid-cols-[180px_1fr]">
            <div>
              <span className="text-xs font-black uppercase text-primary">Predicted score</span>
              <div className="mt-1 text-5xl font-black leading-none">{nf.format(props.prediction.score)}</div>
              <Badge className="mt-2">{props.prediction.tier}</Badge>
            </div>
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Based on {props.prediction.neighbors.length} nearby turfs around {props.prediction.location.label}
                {props.prediction.usedFallback ? " using nearest turfs beyond the requested radius." : "."}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {props.prediction.neighbors.slice(0, 4).map(item => (
                  <div key={rowKey(item.row)} className="border border-border bg-background p-3 text-sm">
                    <div className="font-black">{item.row.display_location || item.row.GIDBG}</div>
                    <div className="text-muted-foreground">{nf.format(item.distance)} mi · score {nf.format(item.score)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <p className="border border-dashed border-border p-4 text-sm font-medium text-muted-foreground">Prediction will appear here after the CSV loads.</p>
        )}
      </CardContent>
    </Card>
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

function TurfMap() {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const turfLayerRef = useRef<LeafletGeoJSON | null>(null);
  const municipalLayerRef = useRef<LeafletGeoJSON | null>(null);
  const [leaflet, setLeaflet] = useState<typeof import("leaflet") | null>(null);
  const [geojson, setGeojson] = useState<GeoJsonCollection | null>(null);
  const [municipalGeojson, setMunicipalGeojson] = useState<GeoJsonCollection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeLayerField, setActiveLayerField] = useState("overall_score");
  const [activePreset, setActivePreset] = useState("");
  const [activeGeographyPreset, setActiveGeographyPreset] = useState("");
  const [mapCounties, setMapCounties] = useState<string[]>([]);
  const [mapMunicipalities, setMapMunicipalities] = useState<string[]>([]);
  const [rawLayers, setRawLayers] = useState<MapLayerDefinition[]>([]);

  const activeLayer = useMemo(
    () => [...mapLayerCatalog, ...rawLayers].find(layer => layer.field === activeLayerField) ?? mapLayerCatalog[0],
    [activeLayerField, rawLayers],
  );
  const mapGeographyOptions = useMemo(() => ({
    counties: unique((geojson?.features || []).map(feature => String(feature.properties?.County_name || "")).filter(Boolean)),
    municipalities: unique((geojson?.features || []).map(feature => String(feature.properties?.municipality_name || "")).filter(Boolean)),
  }), [geojson]);
  const filteredGeojson = useMemo(() => {
    if (!geojson) return null;
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
  }, [activeGeographyPreset, activePreset, geojson, mapCounties, mapMunicipalities]);
  const filteredMunicipalGeojson = useMemo(() => {
    if (!municipalGeojson || !filteredGeojson) return null;
    const visibleMunicipalities = new Set(filteredGeojson.features.map(feature => String(feature.properties?.municipality_name || "")).filter(Boolean));
    return {
      type: "FeatureCollection",
      features: municipalGeojson.features.filter(feature => visibleMunicipalities.has(municipalityLabel(feature.properties))),
    } satisfies GeoJsonCollection;
  }, [filteredGeojson, municipalGeojson]);

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
    if (!leaflet || !mapNodeRef.current || mapRef.current) return;
    mapRef.current = leaflet.map(mapNodeRef.current, { preferCanvas: true }).setView([42.25, -71.8], 8);
    leaflet.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(mapRef.current);
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [leaflet]);

  useEffect(() => {
    const map = mapRef.current;
    if (!leaflet || !map || !filteredGeojson || !filteredMunicipalGeojson) return;
    turfLayerRef.current?.remove();
    municipalLayerRef.current?.remove();
    const preset = activePreset ? mapPresetDefinitions[activePreset] : null;
    turfLayerRef.current = leaflet.geoJSON(filteredGeojson as GeoJSON.GeoJsonObject, {
      style: feature => mapFeatureStyle(feature as GeoJsonFeature, activeLayer, activeLayerField, filteredGeojson, preset),
      onEachFeature: (feature, layer) => {
        const properties = (feature as GeoJsonFeature).properties || {};
        layer.bindTooltip(mapTooltipHtml(properties, activeLayer), { sticky: true });
        layer.bindPopup(mapPopupHtml(properties, activeLayer));
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
    try {
      map.fitBounds(turfLayerRef.current.getBounds(), { padding: [18, 18] });
    } catch {
      map.setView([42.25, -71.8], 8);
    }
  }, [activeLayer, activeLayerField, activePreset, filteredGeojson, filteredMunicipalGeojson, leaflet]);

  const insightRows = useMemo(() => {
    if (!filteredGeojson) return [];
    return filteredGeojson.features
      .map(feature => ({ feature, value: mapValue(feature.properties, activeLayerField) }))
      .filter(item => Number.isFinite(item.value))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [activeLayerField, filteredGeojson]);

  function zoomToFeature(gid: string) {
    const map = mapRef.current;
    const layerGroup = turfLayerRef.current;
    if (!map || !layerGroup) return;
    layerGroup.eachLayer(layer => {
      const feature = (layer as LeafletLayer & { feature?: GeoJsonFeature }).feature;
      const properties = feature?.properties || {};
      if ((properties.GIDBG || properties.GEOID) !== gid) return;
      if ("getBounds" in layer) map.fitBounds((layer as Polygon).getBounds(), { maxZoom: 13, padding: [36, 36] });
      layer.bindPopup(mapPopupHtml(properties, activeLayer)).openPopup();
    });
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <CardTitle>Massachusetts Block Group Turf Map</CardTitle>
          <CardDescription>
            {loading ? "Loading scored block groups..." : error || mapStatusText(geojson, filteredGeojson, activeGeographyPreset)}
          </CardDescription>
        </div>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <LabeledControl label="Area preset">
            <Select value={activeGeographyPreset || "none"} onValueChange={value => {
              const selectedValue = value || "none";
              const next = selectedValue === "none" ? "" : selectedValue;
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
          <MultiSelect label="Map counties" values={mapGeographyOptions.counties} selected={mapCounties} onSelectedChange={next => { setActiveGeographyPreset(""); setMapCounties(next); }} emptyLabel="Choose counties" />
          <MultiSelect label="Map municipalities" values={mapGeographyOptions.municipalities} selected={mapMunicipalities} onSelectedChange={next => { setActiveGeographyPreset(""); setMapMunicipalities(next); }} emptyLabel="Choose towns" />
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
        <div className="relative h-[72vh] min-h-[560px] bg-muted">
          <div ref={mapNodeRef} className="size-full" aria-label="Block group choropleth map" />
          <div className="absolute left-14 top-4 z-[500] max-h-[calc(100%-2rem)] w-[min(360px,calc(100%-5rem))] overflow-auto border border-border bg-card/95 p-3 shadow-xl backdrop-blur">
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
              {!loading && !insightRows.length ? <p className="border border-border bg-muted/40 p-3 text-sm font-medium text-muted-foreground">Choose an area preset, county, or municipality to render block groups.</p> : null}
              {insightRows.map(({ feature, value }) => {
                const properties = feature.properties || {};
                const gid = String(properties.GIDBG || properties.GEOID || "");
                return (
                  <Button key={gid} variant="ghost" className="h-auto justify-start p-2 text-left" onClick={() => zoomToFeature(gid)}>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{String(properties.display_location || properties.municipality_name || gid)}</span>
                      <span className="text-xs text-muted-foreground">{formatMapValue(value, activeLayer)} · {String(properties.recommended_outreach_channel || "channel n/a")}</span>
                    </span>
                  </Button>
                );
              })}
            </div>
          </div>
          <MapLegend layer={activeLayer} field={activeLayerField} geojson={filteredGeojson} />
        </div>
      </CardContent>
    </Card>
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

function readSavedState(): SavedState {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(storageKey) || "{}") as SavedState;
  } catch {
    return {};
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
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Geocoding request failed.");
  const results = await response.json() as Array<{ lat: string; lon: string; display_name: string }>;
  const result = results[0];
  return result ? { lat: Number(result.lat), lon: Number(result.lon), label: result.display_name } : null;
}

function predictFromLocation(location: PredictionLocation, rows: TurfRow[], primaryScoreCol: string, radius: number, limit: number): Prediction {
  const candidates = rows
    .map(row => {
      const lat = number(row.location_latitude);
      const lon = number(row.location_longitude);
      return Number.isFinite(lat) && Number.isFinite(lon)
        ? { row, distance: distanceMiles(location.lat, location.lon, lat, lon), score: primaryScore(row, primaryScoreCol) }
        : null;
    })
    .filter(Boolean) as Neighbor[];
  candidates.sort((a, b) => a.distance - b.distance);
  const withinRadius = candidates.filter(item => item.distance <= Math.max(0.1, radius));
  const neighbors = (withinRadius.length ? withinRadius : candidates).slice(0, Math.max(1, Math.min(25, Math.round(limit || 8))));
  const weighted = neighbors.reduce((state, item) => {
    const weight = 1 / Math.max(item.distance, 0.08);
    return { score: state.score + item.score * weight, weight: state.weight + weight };
  }, { score: 0, weight: 0 });
  const score = weighted.weight ? weighted.score / weighted.weight : 0;
  return { location, score, tier: scoreTier(score), neighbors, usedFallback: !withinRadius.length };
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

function mapFeatureStyle(feature: GeoJsonFeature, layer: MapLayerDefinition, field: string, geojson: GeoJsonCollection, preset: MapPreset | null): PathOptions {
  const properties = feature.properties || {};
  const matchesPreset = !preset || preset.test(properties);
  return {
    color: matchesPreset ? "#1f2937" : "#9ca3af",
    weight: matchesPreset ? 0.8 : 0.35,
    opacity: matchesPreset ? 0.65 : 0.3,
    fillColor: getMapColor(mapValue(properties, field), layer, field, geojson),
    fillOpacity: matchesPreset ? 0.78 : 0.12,
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

function mapStatusText(geojson: GeoJsonCollection | null, filteredGeojson: GeoJsonCollection | null, geographyPreset: string) {
  const total = geojson?.features.length ?? 0;
  const visible = filteredGeojson?.features.length ?? 0;
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
  const usefulFields = ["display_location", "County_name", "municipality_name", "overall_tier", "score_tier", "election_adjusted_tier", "estimated_donors", "total_population"];
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

function scoreTier(score: number) {
  if (score >= 80) return "A priority";
  if (score >= 65) return "B strong";
  if (score >= 50) return "C moderate";
  if (score >= 35) return "D low";
  return "E avoid";
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



