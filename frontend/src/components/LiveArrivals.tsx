import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Loader, RefreshCw, MapPin, Clock, Train } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ArrivalsResponseSchema, type Arrival, type ArrivalsData } from '@/lib/apiSchemas';

interface LiveArrivalsProps {
  stopCode: string;
  stopName: string;
  line: 'green' | 'red';
}

const BACKEND_URL = import.meta.env.VITE_API_URL || 'https://luas-tracker-production.up.railway.app';

// Valid stop codes are 3 lowercase letters (e.g., 'cab', 'tal', 'bri')
const VALID_STOP_CODE_PATTERN = /^[a-z]{3}$/i;

export function LiveArrivals({ stopCode, stopName, line }: LiveArrivalsProps) {
  const [arrivals, setArrivals] = useState<ArrivalsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchArrivals = useCallback(async () => {
    // Validate stop code format before making API request
    if (!VALID_STOP_CODE_PATTERN.test(stopCode)) {
      setError('Invalid stop code format');
      setLoading(false);
      return;
    }
    
    try {
      setIsRefreshing(true);
      setError(null);
      const response = await fetch(`${BACKEND_URL}/arrivals/${encodeURIComponent(stopCode)}?limit=6`);
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      const rawData = await response.json();
      const parseResult = ArrivalsResponseSchema.safeParse(rawData);
      
      if (!parseResult.success) {
        console.warn('API response validation failed:', parseResult.error.message);
        throw new Error('Invalid API response format');
      }
      
      setArrivals(parseResult.data);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
      console.error('Failed to fetch arrivals:', err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [stopCode]);

  useEffect(() => {
    fetchArrivals();
  }, [fetchArrivals]);

  useEffect(() => {
    const interval = setInterval(fetchArrivals, 30000);
    return () => clearInterval(interval);
  }, [fetchArrivals]);

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-IE', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatLastUpdated = (date: Date | null) => {
    if (!date) return '';
    return date.toLocaleTimeString('en-IE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const getMinutesColor = (minutes: number) => {
    if (minutes <= 2) return 'text-luas-red';
    if (minutes <= 5) return 'text-amber-600';
    return 'text-luas-green';
  };

  const getStatusIndicator = (minutes: number) => {
    if (minutes <= 2) return { color: 'bg-luas-red', pulse: true, text: 'Arriving' };
    if (minutes <= 5) return { color: 'bg-amber-500', pulse: false, text: 'Approaching' };
    return { color: 'bg-luas-green', pulse: false, text: 'On time' };
  };

  const lineColor = line === 'green' ? 'luas-green' : 'luas-red';
  const lineBgClass = line === 'green' ? 'bg-luas-green' : 'bg-luas-red';
  const lineTextClass = line === 'green' ? 'text-luas-green' : 'text-luas-red';

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
      {/* Header with line color */}
      <div className={cn("px-4 py-3", lineBgClass)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MapPin className="h-5 w-5 text-white" />
            <div>
              <h2 className="text-lg font-bold text-white">{stopName}</h2>
              <span className="text-xs text-white/80">
                {line === 'green' ? 'Green Line' : 'Red Line'}
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchArrivals}
            disabled={isRefreshing}
            className="text-white hover:bg-white/20 hover:text-white"
          >
            <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className="p-4">
        {/* Last Updated */}
        {lastUpdated && (
          <p className="text-xs text-muted-foreground mb-3">
            Updated: {formatLastUpdated(lastUpdated)}
          </p>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Loader className={cn("h-6 w-6 animate-spin", lineTextClass)} />
            <p className="text-sm text-muted-foreground">Loading arrivals...</p>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex gap-3">
            <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-destructive text-sm">Unable to load</h3>
              <p className="text-xs text-destructive/80 mt-1">{error}</p>
              <Button
                variant="destructive"
                size="sm"
                onClick={fetchArrivals}
                className="mt-2 h-7 text-xs"
              >
                Retry
              </Button>
            </div>
          </div>
        )}

        {/* Arrivals List - Separated by Direction */}
        {!loading && !error && arrivals?.next_arrivals && arrivals.next_arrivals.length > 0 && (() => {
          const inbound = arrivals.next_arrivals.filter(a => a.direction === 'Inbound');
          const outbound = arrivals.next_arrivals.filter(a => a.direction === 'Outbound');
          
          const renderArrivalRow = (arrival: Arrival, index: number) => {
            const status = getStatusIndicator(arrival.due_minutes);
            return (
              <div
                key={index}
                className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-b-0"
              >
                <div className="flex-1">
                  <p className="font-semibold text-foreground text-sm">
                    {arrival.destination === 'Unknown' ? 'Service' : arrival.destination}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {formatTime(arrival.due_time)}
                    </span>
                    <div className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      status.color,
                      status.pulse && "animate-pulse"
                    )} />
                    <span className="text-xs text-muted-foreground">{status.text}</span>
                  </div>
                </div>

                {/* Minutes Display */}
                <div className="flex items-baseline gap-0.5">
                  <span className={cn(
                    "text-2xl font-bold",
                    getMinutesColor(arrival.due_minutes)
                  )}>
                    {arrival.due_minutes}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    min
                  </span>
                </div>
              </div>
            );
          };

          return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Outbound Column */}
              <div>
                <div className="flex items-center gap-2 mb-2 pb-2 border-b-2 border-primary">
                  <span className="text-xs font-bold text-primary uppercase tracking-wide">
                    Outbound
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ({outbound.length})
                  </span>
                </div>
                {outbound.length > 0 ? (
                  <div>
                    {outbound.slice(0, 4).map((arrival, index) => renderArrivalRow(arrival, index))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground py-3 text-center">No trains</p>
                )}
              </div>

              {/* Inbound Column */}
              <div>
                <div className="flex items-center gap-2 mb-2 pb-2 border-b-2 border-primary">
                  <span className="text-xs font-bold text-primary uppercase tracking-wide">
                    Inbound
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ({inbound.length})
                  </span>
                </div>
                {inbound.length > 0 ? (
                  <div>
                    {inbound.slice(0, 4).map((arrival, index) => renderArrivalRow(arrival, index))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground py-3 text-center">No trains</p>
                )}
              </div>
            </div>
          );
        })()}

        {/* Empty State */}
        {!loading && !error && arrivals?.next_arrivals?.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Train className="h-6 w-6 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No trams scheduled</p>
            <Button variant="outline" size="sm" onClick={fetchArrivals} className="mt-3 h-7 text-xs">
              Check Again
            </Button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 bg-muted/30 border-t border-border">
        <p className="text-center text-xs text-muted-foreground">
          Auto-refreshes every 30s
        </p>
      </div>
    </div>
  );
}
