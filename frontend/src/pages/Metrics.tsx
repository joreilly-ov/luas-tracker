import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, Target, BarChart3, Loader, AlertCircle, RefreshCw, MapPin, Bug, ChevronDown, ChevronUp, Database, Activity, Server, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getOfficialLineForStopName } from '@/lib/luasStopLines';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  StopsResponseSchema,
  MetricsResponseSchema,
  HealthResponseSchema,
  DatabaseDebugSchema,
  CollectionDebugSchema,
  type DestinationAccuracy,
  type MetricsData,
} from '@/lib/apiSchemas';

interface Stop {
  code: string;
  name: string;
  line: string;
}

interface BackendHealth {
  status?: string;
  uptime?: number;
  version?: string;
  database?: {
    connected?: boolean;
    predictions_count?: number;
    accuracy_count?: number;
    last_prediction?: string;
    last_accuracy?: string;
  };
  collection?: {
    active?: boolean;
    last_fetch?: string;
    stops_monitored?: number;
  };
  error?: string;
  raw?: unknown;
}

// Only show debug panel in development mode
const isDevelopment = import.meta.env.DEV;

const BACKEND_URL = import.meta.env.VITE_API_URL || '';

// The 12 major stops we track accuracy data for (to respect API rate limits)
const TRACKED_STOPS = new Set([
  // Green Line major stops
  'bro', // Broombridge
  'cab', // Cabra
  'sts', // St. Stephen's Green
  'ran', // Ranelagh
  'san', // Sandyford
  'bri', // Brides Glen
  // Red Line major stops
  'tal', // Tallaght
  'red', // The Red Cow
  'heu', // Heuston
  'jer', // Jervis
  'con', // Connolly
  'tpt', // The Point
]);

// Valid stop codes are 3 lowercase letters (e.g., 'cab', 'tal', 'bri')
const VALID_STOP_CODE_PATTERN = /^[a-z]{3}$/i;

export default function Metrics() {
  const [stops, setStops] = useState<Stop[]>([]);
  const [selectedStop, setSelectedStop] = useState<string>('cab');
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [stopsLoading, setStopsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  
  // Debug state
  const [debugOpen, setDebugOpen] = useState(false);
  const [healthData, setHealthData] = useState<BackendHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  // Fetch backend health/debug info
  const fetchBackendHealth = useCallback(async () => {
    setHealthLoading(true);
    const health: BackendHealth = {};
    
    try {
      // Try /health endpoint
      const healthRes = await fetch(`${BACKEND_URL}/health`, { cache: 'no-store' });
      if (healthRes.ok) {
        const data = await healthRes.json();
        health.status = data.status || 'ok';
        health.raw = data;
      }
    } catch (e) {
      health.status = 'unreachable';
    }

    // Fetch database debug info
    try {
      const dbDebugRes = await fetch(`${BACKEND_URL}/debug/database`, { cache: 'no-store' });
      if (dbDebugRes.ok) {
        const data = await dbDebugRes.json();
        health.database = {
          connected: data.healthy ?? data.connected ?? data.status === 'healthy',
          predictions_count: data.predictions_count ?? data.record_count,
          accuracy_count: data.accuracy_count,
          last_prediction: data.last_prediction ?? data.last_write,
          last_accuracy: data.last_accuracy,
        };
        health.raw = { 
          ...(typeof health.raw === 'object' && health.raw !== null ? health.raw : {}), 
          database: data 
        };
      }
    } catch (e) {
      // Database debug endpoint might not exist yet
    }

    // Fetch data collection debug info
    try {
      const collectionRes = await fetch(`${BACKEND_URL}/debug/data-collection`, { cache: 'no-store' });
      if (collectionRes.ok) {
        const data = await collectionRes.json();
        health.collection = {
          active: data.healthy ?? data.active ?? data.is_collecting,
          last_fetch: data.last_poll ?? data.last_fetch,
          stops_monitored: data.stops_monitored ?? data.stops_count,
        };
        health.raw = { 
          ...(typeof health.raw === 'object' && health.raw !== null ? health.raw : {}), 
          collection: data 
        };
      }
    } catch (e) {
      // Data collection debug endpoint might not exist yet
    }

    // If we got nothing useful, try a basic connectivity test
    if (!health.status && !health.database) {
      try {
        const testRes = await fetch(`${BACKEND_URL}/stops`, { cache: 'no-store' });
        health.status = testRes.ok ? 'ok (stops endpoint)' : 'error';
      } catch {
        health.status = 'unreachable';
        health.error = 'Cannot connect to backend';
      }
    }

    setHealthData(health);
    setHealthLoading(false);
  }, []);

  // Fetch health when debug panel opens
  useEffect(() => {
    if (debugOpen && !healthData) {
      fetchBackendHealth();
    }
  }, [debugOpen, healthData, fetchBackendHealth]);

  // Fetch stops from API
  useEffect(() => {
    const fetchStops = async () => {
      try {
        const response = await fetch(`${BACKEND_URL}/stops`);
        if (!response.ok) throw new Error('Failed to fetch stops');
        const rawData = await response.json();
        
        // Validate the response against our schema
        const parseResult = StopsResponseSchema.safeParse(rawData);
        if (!parseResult.success) {
          console.warn('Stops API response validation failed:', parseResult.error.message);
          throw new Error('Invalid API response format');
        }
        
        const data = parseResult.data;
        
        // Combine all stops and use official line assignments (backend mapping is unreliable)
        const allStops: Stop[] = [
          ...data.stops.green.map((s) => ({
            code: s.code,
            name: s.name,
            line:
              getOfficialLineForStopName(s.name) ??
              (String(s.line ?? 'Green').toLowerCase().includes('red') ? 'Red Line' : 'Green Line'),
          })),
          ...data.stops.red.map((s) => ({
            code: s.code,
            name: s.name,
            line:
              getOfficialLineForStopName(s.name) ??
              (String(s.line ?? 'Red').toLowerCase().includes('red') ? 'Red Line' : 'Green Line'),
          })),
        ];
        
        setStops(allStops);
        // Keep 'cab' as default if it exists, otherwise first stop
        const cabra = allStops.find(s => s.code === 'cab');
        setSelectedStop(prev => prev || (cabra ? 'cab' : allStops[0]?.code || ''));
      } catch (err) {
        console.error('Failed to fetch stops:', err);
        // Fallback to hardcoded stops
        const fallbackStops = [
          { code: 'cab', name: 'Cabra', line: 'Green Line' },
          { code: 'tal', name: 'Tallaght', line: 'Red Line' },
        ];
        setStops(fallbackStops);
        setSelectedStop('cab');
      } finally {
        setStopsLoading(false);
      }
    };
    fetchStops();
  }, []);

  const fetchMetrics = useCallback(async () => {
    // Validate stop code format before making API request
    if (!VALID_STOP_CODE_PATTERN.test(selectedStop)) {
      setError('Invalid stop code format');
      setLoading(false);
      return;
    }
    
    try {
      setIsRefreshing(true);
      setError(null);
      const response = await fetch(`${BACKEND_URL}/accuracy/summary?stop_code=${encodeURIComponent(selectedStop)}&_ts=${Date.now()}`, { cache: 'no-store' });
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      const rawData = await response.json();
      
      // Validate the response against our schema
      const parseResult = MetricsResponseSchema.safeParse(rawData);
      if (!parseResult.success) {
        console.warn('Metrics API response validation failed:', parseResult.error.message);
        throw new Error('Invalid API response format');
      }
      
      setMetrics(parseResult.data);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch metrics');
      console.error('Failed to fetch metrics:', err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [selectedStop]);

  useEffect(() => {
    if (selectedStop) {
      setLoading(true);
      fetchMetrics();
    }
  }, [fetchMetrics, selectedStop]);

  const currentStop = stops.find((s) => s.code === selectedStop) ?? stops[0] ?? null;
  // Filter to only show the 12 tracked stops
  const trackedStops = stops.filter((s) => TRACKED_STOPS.has(s.code));
  const greenStops = trackedStops.filter((s) => s.line === 'Green Line');
  const redStops = trackedStops.filter((s) => s.line === 'Red Line');
  const formatAccuracy = (minutes: number) => {
    if (minutes === 0) return 'On time';
    const absMinutes = Math.abs(minutes);
    const rounded = absMinutes.toFixed(1);
    return minutes > 0 ? `${rounded} min late` : `${rounded} min early`;
  };

  const getAccuracyColor = (minutes: number) => {
    const abs = Math.abs(minutes);
    if (abs <= 1) return 'text-luas-green';
    if (abs <= 3) return 'text-amber-600';
    return 'text-luas-red';
  };

  const formatHour = (timestampString: string) => {
    // Handle format like "2025-12-30 12:00"
    const parts = timestampString.split(' ');
    if (parts.length === 2) {
      return parts[1];
    }
    return timestampString;
  };

  const formatLastUpdated = (date: Date) => {
    return date.toLocaleTimeString('en-IE', { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-4 py-8">
        {/* Stop Selector */}
        <div className="mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-3">
              <MapPin className="h-5 w-5 text-muted-foreground" />
              <Select
                value={selectedStop}
                onValueChange={setSelectedStop}
                disabled={stopsLoading || stops.length === 0}
              >
                <SelectTrigger className="w-[200px] bg-card">
                  <SelectValue placeholder={stopsLoading ? "Loading stops..." : "Select a stop"} />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {greenStops.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="text-xs text-muted-foreground">Green Line</SelectLabel>
                      {greenStops.map((stop) => (
                        <SelectItem key={stop.code} value={stop.code}>
                          {stop.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}

                  {greenStops.length > 0 && redStops.length > 0 && <SelectSeparator />}

                  {redStops.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="text-xs text-muted-foreground">Red Line</SelectLabel>
                      {redStops.map((stop) => (
                        <SelectItem key={stop.code} value={stop.code}>
                          {stop.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={fetchMetrics}
                disabled={isRefreshing || stopsLoading || !selectedStop}
              >
                <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
              </Button>
              {lastUpdated && (
                <span className="text-xs text-muted-foreground hidden sm:block">
                  Updated {formatLastUpdated(lastUpdated)}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Our metric system only tracks 12 "major stops" out of 67 total stops on the Luas network. This is to abide by API rate limiting [and Lovable credit cost!!].
            </p>
          </div>
        </div>

        {/* Debug Panel - Only visible in development mode */}
        {isDevelopment && (
          <Collapsible open={debugOpen} onOpenChange={setDebugOpen} className="mb-6">
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 text-muted-foreground">
                <Bug className="h-4 w-4" />
                Backend Debug
                {debugOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-4">
              <div className="rounded-xl border border-border bg-card p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-foreground flex items-center gap-2">
                    <Server className="h-4 w-4" />
                    Backend Health & Stats
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={fetchBackendHealth}
                    disabled={healthLoading}
                  >
                    <RefreshCw className={cn("h-4 w-4", healthLoading && "animate-spin")} />
                  </Button>
                </div>

                {healthLoading && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader className="h-4 w-4 animate-spin" />
                    Checking backend...
                  </div>
                )}

                {!healthLoading && healthData && (
                  <div className="grid gap-4 md:grid-cols-3">
                    {/* Status Card */}
                    <div className="rounded-lg border border-border p-4 bg-muted/30">
                      <div className="flex items-center gap-2 mb-2">
                        <Activity className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Status</span>
                      </div>
                      <p className={cn(
                        "text-lg font-bold",
                        healthData.status === 'ok' || healthData.status?.includes('ok') 
                          ? "text-luas-green" 
                          : "text-destructive"
                      )}>
                        {healthData.status || 'Unknown'}
                      </p>
                      {healthData.error && (
                        <p className="text-xs text-destructive mt-1">{healthData.error}</p>
                      )}
                    </div>

                    {/* Database Card */}
                    <div className="rounded-lg border border-border p-4 bg-muted/30">
                      <div className="flex items-center gap-2 mb-2">
                        <Database className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Database</span>
                      </div>
                      {healthData.database ? (
                        <div className="space-y-1 text-sm">
                          <p>Predictions: <span className="font-mono">{healthData.database.predictions_count ?? 'N/A'}</span></p>
                          <p>Accuracy Records: <span className="font-mono">{healthData.database.accuracy_count ?? 'N/A'}</span></p>
                          {healthData.database.last_prediction && (
                            <p className="text-xs text-muted-foreground">Last: {healthData.database.last_prediction}</p>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No stats endpoint found</p>
                      )}
                    </div>

                    {/* Collection Card */}
                    <div className="rounded-lg border border-border p-4 bg-muted/30">
                      <div className="flex items-center gap-2 mb-2">
                        <Train className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Data Collection</span>
                      </div>
                      {healthData.collection ? (
                        <div className="space-y-1 text-sm">
                          <p>Active: <span className={cn(
                            "font-bold",
                            healthData.collection.active ? "text-luas-green" : "text-destructive"
                          )}>{healthData.collection.active ? 'Yes' : 'No'}</span></p>
                          {healthData.collection.stops_monitored && (
                            <p>Stops: <span className="font-mono">{healthData.collection.stops_monitored}</span></p>
                          )}
                          {healthData.collection.last_fetch && (
                            <p className="text-xs text-muted-foreground">Last fetch: {healthData.collection.last_fetch}</p>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No collection stats found</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Raw Response */}
                {!healthLoading && healthData?.raw && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      Raw API Response
                    </summary>
                    <pre className="mt-2 p-3 bg-muted rounded-lg overflow-x-auto text-foreground">
                      {JSON.stringify(healthData.raw, null, 2)}
                    </pre>
                  </details>
                )}

                {!healthLoading && !healthData && (
                  <p className="text-sm text-muted-foreground">
                    Click refresh to check backend status
                  </p>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Loading metrics...</p>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 flex gap-3 max-w-md mx-auto">
            <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-destructive">Unable to load metrics</h3>
              <p className="text-sm text-destructive/80 mt-1">{error}</p>
              <Button
                variant="destructive"
                size="sm"
                onClick={fetchMetrics}
                className="mt-3"
              >
                Retry
              </Button>
            </div>
          </div>
        )}

        {/* Metrics Content */}
        {!loading && !error && metrics && (
          <div className="space-y-8">
            {/* No Data State */}
            {(!metrics.data || metrics.data.length === 0) && (
              <div className="rounded-xl border border-border bg-card p-8 text-center">
                <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-foreground mb-2">No Accuracy Data Yet</h3>
                <p className="text-muted-foreground">
                  {metrics.message || "Accuracy data will appear once predictions are tracked and compared to actual arrivals."}
                </p>
                {metrics.debug_info && (
                  <div className="mt-4 inline-flex flex-col gap-1 text-xs text-muted-foreground bg-muted/50 rounded-lg px-4 py-3">
                    <span>Total accuracy records in database: <span className="font-mono font-semibold text-foreground">{metrics.debug_info.total_records_in_db.toLocaleString()}</span></span>
                    <span>Records for this stop: <span className="font-mono font-semibold text-foreground">{metrics.debug_info.records_for_this_stop.toLocaleString()}</span></span>
                  </div>
                )}
              </div>
            )}

            {/* Overview Cards - Only show when we have data */}
            {metrics.data && metrics.data.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <div className="h-1 w-8 bg-primary rounded-full" />
                  <h2 className="text-lg font-semibold text-foreground">Overview</h2>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  {/* Overall Accuracy */}
                  {(() => {
                    const totalMeasurements = metrics.data.reduce((sum, d) => sum + d.measurements, 0);
                    const avgAccuracy = metrics.data.reduce((sum, d) => sum + d.avg_accuracy_minutes * d.measurements, 0) / totalMeasurements;
                    const bestCase = Math.max(...metrics.data.map(d => d.best_case_minutes));
                    const worstCase = Math.min(...metrics.data.map(d => d.worst_case_minutes));
                    
                    return (
                      <>
                        <div className="rounded-xl border border-border bg-card p-6">
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="text-sm text-muted-foreground">Average Accuracy</p>
                              <p className={cn(
                                "mt-2 text-3xl font-bold",
                                getAccuracyColor(avgAccuracy)
                              )}>
                                {formatAccuracy(avgAccuracy)}
                              </p>
                            </div>
                            <div className="rounded-lg p-2 bg-muted">
                              <TrendingUp className="h-5 w-5 text-muted-foreground" />
                            </div>
                          </div>
                        </div>

                        {/* Best/Worst Case */}
                        <div className="rounded-xl border border-border bg-card p-6">
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="text-sm text-muted-foreground">Best Case</p>
                              <p className={cn("mt-2 text-3xl font-bold", getAccuracyColor(bestCase))}>
                                {formatAccuracy(bestCase)}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">earliest arrival</p>
                            </div>
                            <div className="rounded-lg p-2 bg-luas-green/10">
                              <Target className="h-5 w-5 text-luas-green" />
                            </div>
                          </div>
                        </div>

                        {/* Total Samples */}
                        <div className="rounded-xl border border-border bg-card p-6">
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="text-sm text-muted-foreground">Total Measurements</p>
                              <p className="mt-2 text-3xl font-bold text-foreground">
                                {totalMeasurements.toLocaleString()}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">all time</p>
                            </div>
                            <div className="rounded-lg p-2 bg-muted">
                              <Clock className="h-5 w-5 text-muted-foreground" />
                            </div>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </section>
            )}

            {/* Accuracy Chart */}
            {metrics.data && metrics.data.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <div className="h-1 w-8 bg-primary rounded-full" />
                  <h2 className="text-lg font-semibold text-foreground">Accuracy by Destination</h2>
                </div>
                <div className="rounded-xl border border-border bg-card p-6">
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={metrics.data.map(d => ({
                        name: `${d.destination} (${d.direction.slice(0, 2)})`,
                        accuracy: d.avg_accuracy_minutes,
                        best: d.best_case_minutes,
                        worst: d.worst_case_minutes,
                      }))}
                      layout="vertical"
                      margin={{ top: 5, right: 30, left: 100, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis 
                        type="number" 
                        domain={['dataMin - 1', 'dataMax + 1']}
                        tickFormatter={(value) => `${value > 0 ? '+' : ''}${value.toFixed(1)}m`}
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={12}
                      />
                      <YAxis 
                        type="category" 
                        dataKey="name" 
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={12}
                        width={95}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                        }}
                        labelStyle={{ color: 'hsl(var(--foreground))' }}
                        formatter={(value: number) => [
                          value === 0 ? 'On time' : `${Math.abs(value).toFixed(1)} min ${value > 0 ? 'late' : 'early'}`,
                          'Avg Accuracy'
                        ]}
                      />
                      <ReferenceLine x={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                      <Bar dataKey="accuracy" radius={[0, 4, 4, 0]}>
                        {metrics.data.map((entry, index) => {
                          const abs = Math.abs(entry.avg_accuracy_minutes);
                          let fill = 'hsl(142.1 76.2% 36.3%)'; // green
                          if (abs > 3) fill = 'hsl(0 84.2% 60.2%)'; // red
                          else if (abs > 1) fill = 'hsl(45 93% 47%)'; // amber
                          return <Cell key={`cell-${index}`} fill={fill} />;
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="flex justify-center gap-6 mt-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'hsl(142.1 76.2% 36.3%)' }} />
                      <span>≤1 min (Good)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'hsl(45 93% 47%)' }} />
                      <span>1-3 min (Fair)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'hsl(0 84.2% 60.2%)' }} />
                      <span>&gt;3 min (Poor)</span>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* By Destination Table */}
            {metrics.data && metrics.data.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <div className="h-1 w-8 bg-primary rounded-full" />
                  <h2 className="text-lg font-semibold text-foreground">By Destination</h2>
                </div>
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Destination</TableHead>
                        <TableHead className="text-right">Avg Accuracy</TableHead>
                        <TableHead className="text-right">Best</TableHead>
                        <TableHead className="text-right">Worst</TableHead>
                        <TableHead className="text-right">Samples</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {metrics.data.map((dest, index) => (
                        <TableRow key={index}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <Train className="h-4 w-4 text-primary" />
                              <div>
                                <div>{dest.destination}</div>
                                <div className="text-xs text-muted-foreground">{dest.direction}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className={cn("text-right font-semibold", getAccuracyColor(dest.avg_accuracy_minutes))}>
                            {formatAccuracy(dest.avg_accuracy_minutes)}
                          </TableCell>
                          <TableCell className={cn("text-right", getAccuracyColor(dest.best_case_minutes))}>
                            {formatAccuracy(dest.best_case_minutes)}
                          </TableCell>
                          <TableCell className={cn("text-right", getAccuracyColor(dest.worst_case_minutes))}>
                            {formatAccuracy(dest.worst_case_minutes)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {dest.measurements.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-auto py-6 bg-muted/30">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>Dublin Luas Tram Information</p>
          <p className="text-xs mt-1 opacity-70">Accuracy data from tracked predictions</p>
        </div>
      </footer>
    </div>
  );
}
