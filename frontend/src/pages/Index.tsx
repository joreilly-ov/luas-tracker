import { useState } from "react";
import { MapPin } from "lucide-react";
import { LiveArrivals } from "@/components/LiveArrivals";

const STORAGE_KEY = "luas-selected-stop";
const DEFAULT_STOP = "cab";

const POLLED_STOPS = [
  // Green Line
  { code: "bro", name: "Broombridge",       line: "green" as const },
  { code: "cab", name: "Cabra",             line: "green" as const },
  { code: "sts", name: "St. Stephen's Green", line: "green" as const },
  { code: "ran", name: "Ranelagh",          line: "green" as const },
  { code: "san", name: "Sandyford",         line: "green" as const },
  { code: "bri", name: "Brides Glen",       line: "green" as const },
  // Red Line
  { code: "tal", name: "Tallaght",          line: "red" as const },
  { code: "red", name: "Red Cow",           line: "red" as const },
  { code: "heu", name: "Heuston",           line: "red" as const },
  { code: "jer", name: "Jervis",            line: "red" as const },
  { code: "con", name: "Connolly",          line: "red" as const },
  { code: "tpt", name: "The Point",         line: "red" as const },
];

const greenStops = POLLED_STOPS.filter(s => s.line === "green");
const redStops   = POLLED_STOPS.filter(s => s.line === "red");

const Index = () => {
  const [selectedCode, setSelectedCode] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY) ?? DEFAULT_STOP
  );

  const handleChange = (code: string) => {
    setSelectedCode(code);
    localStorage.setItem(STORAGE_KEY, code);
  };

  const selected = POLLED_STOPS.find(s => s.code === selectedCode) ?? POLLED_STOPS[1];

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-4 py-8">
        <section>
          <div className="flex items-center gap-2 mb-6">
            <div className="h-1 w-8 bg-primary rounded-full" />
            <h2 className="text-lg font-semibold text-foreground">Live Arrivals</h2>
          </div>

          {/* Stop picker */}
          <div className="mb-6 max-w-xs">
            <label htmlFor="stop-select" className="block text-sm font-semibold text-foreground mb-2">
              Stop
            </label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary pointer-events-none" />
              <select
                id="stop-select"
                value={selectedCode}
                onChange={e => handleChange(e.target.value)}
                className="w-full appearance-none rounded-lg border border-border bg-card pl-9 pr-10 py-2.5 text-sm font-medium text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary cursor-pointer"
              >
                <optgroup label="Green Line">
                  {greenStops.map(s => (
                    <option key={s.code} value={s.code}>{s.name}</option>
                  ))}
                </optgroup>
                <optgroup label="Red Line">
                  {redStops.map(s => (
                    <option key={s.code} value={s.code}>{s.name}</option>
                  ))}
                </optgroup>
              </select>
              <svg
                className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <LiveArrivals
              key={selected.code}
              stopCode={selected.code}
              stopName={selected.name}
              line={selected.line}
            />
          </div>
        </section>
      </main>

      <footer className="border-t border-border mt-auto py-6 bg-muted/30">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>Dublin Luas Information</p>
          <p className="text-xs mt-1 opacity-70">
            Powered by{' '}
            <a
              href="https://data.gov.ie/dataset/luas-forecasting-api"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground transition-colors"
            >
              Luas Real-Time API
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
