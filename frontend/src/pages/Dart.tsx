import { useState, useCallback, useEffect } from "react";
import { Train, RefreshCw, AlertCircle, Loader, MapPin, Clock, ArrowLeft, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DART_API_URL = import.meta.env.VITE_API_URL || "";
const STORAGE_KEY = "dart-selected-station";
const DEFAULT_STATION = "BROCK";

// All DART stations in geographic order, south → north
const ALL_STATIONS = [
  { code: "GRYST",  name: "Greystones" },
  { code: "SNKLL",  name: "Shankill" },
  { code: "KLNY",   name: "Killiney" },
  { code: "DLKEY",  name: "Dalkey" },
  { code: "SDCVE",  name: "Sandycove & Glasthule" },
  { code: "GLNGY",  name: "Glenageary" },
  { code: "DLGRE",  name: "Dún Laoghaire" },
  { code: "SLTH",   name: "Salthill & Monkstown" },
  { code: "SEAPT",  name: "Seapoint" },
  { code: "BROCK",  name: "Blackrock" },
  { code: "BTSTN",  name: "Booterstown" },
  { code: "SYDPRD", name: "Sydney Parade" },
  { code: "SDMNT",  name: "Sandymount" },
  { code: "LNDN",   name: "Lansdowne Road" },
  { code: "GCDK",   name: "Grand Canal Dock" },
  { code: "PERSE",  name: "Pearse" },
  { code: "TARA",   name: "Tara Street" },
  { code: "CNLLY",  name: "Connolly" },
  { code: "CNTRF",  name: "Clontarf Road" },
  { code: "KILBK",  name: "Kilbarrack" },
  { code: "RAHNY",  name: "Raheny" },
  { code: "HRMST",  name: "Harmonstown" },
  { code: "BYSDE",  name: "Bayside" },
  { code: "HWTHJ",  name: "Howth Junction & Donaghmede" },
  { code: "SUTT",   name: "Sutton" },
  { code: "HWTH",   name: "Howth" },
  { code: "PMRCK",  name: "Portmarnock" },
  { code: "MHIDE",  name: "Malahide" },
];

interface DartArrival {
  train_code: string;
  origin: string;
  destination: string;
  direction: string;
  due_in_minutes: number;
  minutes_late: number;
  expected_arrival: string;
  status: string;
  last_location: string;
}

interface StationData {
  station_code: string;
  station_name: string;
  last_updated: string;
  next_arrivals: DartArrival[];
  total_dart_trains: number;
  has_any_service: boolean;
}

function useStationArrivals(stationCode: string) {
  const [data, setData] = useState<StationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const fetch_ = useCallback(async () => {
    try {
      setIsRefreshing(true);
      setError(null);
      const res = await fetch(`${DART_API_URL}/dart/arrivals/${stationCode}?limit=20`);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const json = await res.json();
      setData(json);
      setLastFetched(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [stationCode]);

  useEffect(() => {
    setData(null);
    setLoading(true);
    setError(null);
    fetch_();
  }, [fetch_]);

  useEffect(() => {
    const interval = setInterval(fetch_, 60_000);
    return () => clearInterval(interval);
  }, [fetch_]);

  return { data, loading, error, isRefreshing, lastFetched, refresh: fetch_ };
}

function minutesColor(minutes: number) {
  if (minutes <= 2) return "text-red-500";
  if (minutes <= 5) return "text-amber-600";
  return "text-teal-600";
}

function statusDot(minutes: number) {
  if (minutes <= 2) return { dot: "bg-red-500 animate-pulse", label: "Arriving" };
  if (minutes <= 5) return { dot: "bg-amber-500", label: "Approaching" };
  return { dot: "bg-teal-500", label: "On time" };
}

function ArrivalRow({ arrival }: { arrival: DartArrival }) {
  const { dot, label } = statusDot(arrival.due_in_minutes);
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-b-0">
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-foreground text-sm truncate">{arrival.destination}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <Clock className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          <span className="text-xs text-muted-foreground">{arrival.expected_arrival}</span>
          <div className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0", dot)} />
          <span className="text-xs text-muted-foreground">{label}</span>
          {arrival.minutes_late > 0 && (
            <span className="text-xs text-amber-600 font-medium">
              +{arrival.minutes_late}m late
            </span>
          )}
        </div>
        {arrival.last_location && (
          <p className="text-xs text-muted-foreground/70 mt-0.5 truncate">
            Last seen: {arrival.last_location}
          </p>
        )}
      </div>
      <div className="flex items-baseline gap-0.5 ml-3 flex-shrink-0">
        <span className={cn("text-2xl font-bold", minutesColor(arrival.due_in_minutes))}>
          {arrival.due_in_minutes}
        </span>
        <span className="text-xs text-muted-foreground">min</span>
      </div>
    </div>
  );
}

function isDartOperatingHours(): boolean {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins >= 360 && mins <= 1410; // 06:00 – 23:30
}

function avgDelay(arrivals: DartArrival[]): number | null {
  if (arrivals.length === 0) return null;
  return arrivals.reduce((s, a) => s + a.minutes_late, 0) / arrivals.length;
}

function StationCard({ hookData }: { hookData: ReturnType<typeof useStationArrivals> }) {
  const { data, loading, error, isRefreshing, lastFetched, refresh } = hookData;

  const northbound = data?.next_arrivals.filter(a => a.direction === "Northbound") ?? [];
  const southbound = data?.next_arrivals.filter(a => a.direction === "Southbound") ?? [];

  const noTrains = !loading && !error && data && data.next_arrivals.length === 0;
  const possibleDisruption = noTrains && !data?.has_any_service && isDartOperatingHours();
  const delay = data ? avgDelay(data.next_arrivals) : null;
  const significantDelay = delay !== null && delay >= 5;

  const formatTime = (d: Date) =>
    d.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
      <div className="px-4 py-3 bg-teal-600">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MapPin className="h-5 w-5 text-white" />
            <span className="text-xs text-white/80 font-medium uppercase tracking-wide">DART Line</span>
          </div>
          <div className="flex items-center gap-2">
            {lastFetched && (
              <span className="text-xs text-white/70">
                Updated {formatTime(lastFetched)}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={refresh}
              disabled={isRefreshing}
              className="text-white hover:bg-white/20 hover:text-white h-8 w-8 p-0"
            >
              <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
            </Button>
          </div>
        </div>
      </div>

      <div className="p-4">
        {possibleDisruption && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 flex gap-2 mb-3">
            <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-red-700">Possible service disruption</p>
              <p className="text-xs text-red-600 mt-0.5">
                No trains detected from Irish Rail.{" "}
                <a
                  href="https://www.irishrail.ie/travel-information/service-updates"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline font-medium"
                >
                  Check service updates →
                </a>
              </p>
            </div>
          </div>
        )}

        {significantDelay && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 flex gap-2 mb-3">
            <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">
              <span className="font-semibold">Delays on this line</span> — avg{" "}
              {Math.round(delay!)}m late.{" "}
              <a
                href="https://www.irishrail.ie/travel-information/service-updates"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-medium"
              >
                Service updates →
              </a>
            </p>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <Loader className="h-6 w-6 animate-spin text-teal-600" />
            <p className="text-sm text-muted-foreground">Loading arrivals...</p>
          </div>
        )}

        {error && !loading && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex gap-3">
            <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-destructive text-sm">Unable to load</h3>
              <p className="text-xs text-destructive/80 mt-1">{error}</p>
              <Button variant="destructive" size="sm" onClick={refresh} className="mt-2 h-7 text-xs">
                Retry
              </Button>
            </div>
          </div>
        )}

        {!loading && !error && data && data.next_arrivals.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="flex items-center gap-2 mb-2 pb-2 border-b-2 border-teal-600">
                <ArrowLeft className="h-3.5 w-3.5 text-teal-600" />
                <span className="text-xs font-bold text-teal-600 uppercase tracking-wide">Southbound</span>
                <span className="text-xs text-muted-foreground">({southbound.length})</span>
              </div>
              {southbound.length > 0 ? (
                southbound.slice(0, 5).map((a, i) => <ArrivalRow key={i} arrival={a} />)
              ) : (
                <p className="text-sm text-muted-foreground py-3 text-center">No trains</p>
              )}
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2 pb-2 border-b-2 border-teal-600">
                <ArrowRight className="h-3.5 w-3.5 text-teal-600" />
                <span className="text-xs font-bold text-teal-600 uppercase tracking-wide">Northbound</span>
                <span className="text-xs text-muted-foreground">({northbound.length})</span>
              </div>
              {northbound.length > 0 ? (
                northbound.slice(0, 5).map((a, i) => <ArrivalRow key={i} arrival={a} />)
              ) : (
                <p className="text-sm text-muted-foreground py-3 text-center">No trains</p>
              )}
            </div>
          </div>
        )}

        {!loading && !error && data && data.next_arrivals.length === 0 && !possibleDisruption && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Train className="h-6 w-6 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No DART trains scheduled</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Outside operating hours or end of service</p>
          </div>
        )}
      </div>

      <div className="px-4 py-2 bg-muted/30 border-t border-border">
        <p className="text-center text-xs text-muted-foreground">Auto-refreshes every 60s</p>
      </div>
    </div>
  );
}

const Dart = () => {
  const [selectedCode, setSelectedCode] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY) ?? DEFAULT_STATION
  );

  const hookData = useStationArrivals(selectedCode);

  const handleChange = (code: string) => {
    setSelectedCode(code);
    localStorage.setItem(STORAGE_KEY, code);
  };

  const selectedName = ALL_STATIONS.find(s => s.code === selectedCode)?.name ?? selectedCode;

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-teal-700 text-white">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/10 rounded-lg p-2">
              <Train className="h-7 w-7" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold">DART Tracker</h1>
                <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-400 text-amber-900 px-1.5 py-0.5 rounded">
                  Beta
                </span>
              </div>
              <p className="text-xs opacity-80 hidden sm:block">Irish Rail Real-Time Data</p>
            </div>
          </div>
          <Link to="/">
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-white/30 text-white hover:bg-white/10 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Back to Luas</span>
            </Button>
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-2xl">
        {/* Beta notice */}
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            <span className="font-semibold">Beta — </span>
            Live data from the <span className="font-medium">Irish Rail real-time API</span>, polled every 60s.
          </p>
        </div>

        {/* Station picker */}
        <div className="mb-6">
          <label htmlFor="station-select" className="block text-sm font-semibold text-foreground mb-2">
            Station
          </label>
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-teal-600 pointer-events-none" />
            <select
              id="station-select"
              value={selectedCode}
              onChange={e => handleChange(e.target.value)}
              className="w-full appearance-none rounded-lg border border-border bg-card pl-9 pr-10 py-2.5 text-sm font-medium text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-500 cursor-pointer"
            >
              {ALL_STATIONS.map(s => (
                <option key={s.code} value={s.code}>{s.name}</option>
              ))}
            </select>
            {/* Chevron */}
            <svg
              className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {/* Station name heading */}
        <div className="flex items-center gap-2 mb-4">
          <div className="h-1 w-8 bg-teal-600 rounded-full" />
          <h2 className="text-lg font-semibold text-foreground">{selectedName}</h2>
        </div>

        <StationCard hookData={hookData} />
      </main>

      <footer className="border-t border-border mt-auto py-6 bg-muted/30">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>DART Real-Time Information</p>
          <p className="text-xs mt-1 opacity-70">Powered by Irish Rail Real-Time API</p>
        </div>
      </footer>
    </div>
  );
};

export default Dart;
