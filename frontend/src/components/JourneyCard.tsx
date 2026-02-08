import { Journey } from "@/types/journey";
import { cn } from "@/lib/utils";
import { ArrowRight, Trash2, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";

interface JourneyCardProps {
  journey: Journey;
  onDelete: (id: string) => void;
}

export function JourneyCard({ journey, onDelete }: JourneyCardProps) {
  const isGreen = journey.line === 'green';
  
  return (
    <div 
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-card p-5 transition-all duration-300 hover:scale-[1.01]",
        isGreen ? "border-luas-green/20 hover:border-luas-green/40" : "border-luas-red/20 hover:border-luas-red/40"
      )}
      style={{ animationDelay: '0.1s' }}
    >
      {/* Line indicator */}
      <div className={cn(
        "absolute left-0 top-0 h-full w-1",
        isGreen ? "bg-luas-green" : "bg-luas-red"
      )} />
      
      <div className="flex items-center justify-between">
        <div className="flex-1 pl-3">
          {/* Route */}
          <div className="flex items-center gap-3 text-lg font-semibold">
            <span className="text-foreground">{journey.fromStation}</span>
            <ArrowRight className={cn(
              "h-4 w-4",
              isGreen ? "text-luas-green" : "text-luas-red"
            )} />
            <span className="text-foreground">{journey.toStation}</span>
          </div>
          
          {/* Meta */}
          <div className="mt-2 flex items-center gap-4 text-sm text-muted-foreground">
            <span className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-wide",
              isGreen ? "bg-luas-green/10 text-luas-green" : "bg-luas-red/10 text-luas-red"
            )}>
              {journey.line} line
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {format(new Date(journey.date), 'MMM d, yyyy')}
            </span>
          </div>
          
          {/* Notes */}
          {journey.notes && (
            <p className="mt-2 text-sm text-muted-foreground italic">
              "{journey.notes}"
            </p>
          )}
        </div>
        
        {/* Delete button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onDelete(journey.id)}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
