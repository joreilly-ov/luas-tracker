import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Train } from "lucide-react";
import { LuasLine, GREEN_LINE_STATIONS, RED_LINE_STATIONS } from "@/types/journey";
import { cn } from "@/lib/utils";

interface AddJourneyDialogProps {
  onAdd: (journey: {
    line: LuasLine;
    fromStation: string;
    toStation: string;
    date: string;
    notes?: string;
  }) => void;
}

export function AddJourneyDialog({ onAdd }: AddJourneyDialogProps) {
  const [open, setOpen] = useState(false);
  const [line, setLine] = useState<LuasLine>('green');
  const [fromStation, setFromStation] = useState('');
  const [toStation, setToStation] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');

  const stations = line === 'green' ? GREEN_LINE_STATIONS : RED_LINE_STATIONS;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (fromStation && toStation) {
      onAdd({ line, fromStation, toStation, date, notes: notes || undefined });
      setOpen(false);
      setFromStation('');
      setToStation('');
      setNotes('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="green" size="lg" className="gap-2">
          <Plus className="h-5 w-5" />
          Log Journey
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Train className="h-5 w-5" />
            Log New Journey
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6 pt-4">
          {/* Line Selection */}
          <div className="space-y-2">
            <Label className="text-muted-foreground">Line</Label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setLine('green'); setFromStation(''); setToStation(''); }}
                className={cn(
                  "flex-1 rounded-lg border-2 p-4 transition-all duration-200",
                  line === 'green' 
                    ? "border-luas-green bg-luas-green/10 glow-green" 
                    : "border-border hover:border-luas-green/50"
                )}
              >
                <span className={cn(
                  "font-semibold",
                  line === 'green' ? "text-luas-green" : "text-muted-foreground"
                )}>
                  Green Line
                </span>
              </button>
              <button
                type="button"
                onClick={() => { setLine('red'); setFromStation(''); setToStation(''); }}
                className={cn(
                  "flex-1 rounded-lg border-2 p-4 transition-all duration-200",
                  line === 'red' 
                    ? "border-luas-red bg-luas-red/10 glow-red" 
                    : "border-border hover:border-luas-red/50"
                )}
              >
                <span className={cn(
                  "font-semibold",
                  line === 'red' ? "text-luas-red" : "text-muted-foreground"
                )}>
                  Red Line
                </span>
              </button>
            </div>
          </div>

          {/* From Station */}
          <div className="space-y-2">
            <Label className="text-muted-foreground">From</Label>
            <Select value={fromStation} onValueChange={setFromStation}>
              <SelectTrigger className="bg-muted border-border">
                <SelectValue placeholder="Select station" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border max-h-60">
                {stations.map((station) => (
                  <SelectItem key={station} value={station}>
                    {station}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* To Station */}
          <div className="space-y-2">
            <Label className="text-muted-foreground">To</Label>
            <Select value={toStation} onValueChange={setToStation}>
              <SelectTrigger className="bg-muted border-border">
                <SelectValue placeholder="Select station" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border max-h-60">
                {stations.map((station) => (
                  <SelectItem key={station} value={station}>
                    {station}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date */}
          <div className="space-y-2">
            <Label className="text-muted-foreground">Date</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-muted border-border"
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label className="text-muted-foreground">Notes (optional)</Label>
            <Input
              placeholder="Any notes about this journey..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="bg-muted border-border"
            />
          </div>

          <Button 
            type="submit" 
            variant={line === 'green' ? 'green' : 'red'}
            className="w-full"
            disabled={!fromStation || !toStation}
          >
            Add Journey
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
