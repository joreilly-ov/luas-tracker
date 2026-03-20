import { useState } from "react";
import { Train, Clock, BarChart3, Gamepad2, Map } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import luasMapImage from "@/assets/luas-network-map.png";

export function AppHeader() {
  const [mapOpen, setMapOpen] = useState(false);

  return (
    <header className="bg-primary text-primary-foreground">
      <div className="container mx-auto px-4 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
          <div className="bg-primary-foreground/10 rounded-lg p-2">
            <Train className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Cabra Luas Tracker</h1>
            <p className="text-xs opacity-80 hidden sm:block">Dublin Live Arrivals</p>
          </div>
        </Link>

        <div className="flex items-center gap-1 sm:gap-2">
          {/* DART */}
          <Link to="/dart">
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
              >
                <Train className="h-4 w-4" />
                <span className="hidden sm:inline">DART</span>
              </Button>
              <span className="absolute -top-2 -right-2 text-[9px] font-bold uppercase tracking-wider bg-amber-400 text-amber-900 px-1 py-0.5 rounded leading-none pointer-events-none">
                beta
              </span>
            </div>
          </Link>

          {/* Map */}
          <Dialog open={mapOpen} onOpenChange={setMapOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
              >
                <Map className="h-4 w-4" />
                <span className="hidden sm:inline">Map</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-auto">
              <DialogHeader>
                <DialogTitle>Luas Network Map</DialogTitle>
              </DialogHeader>
              <div className="mt-4">
                <img
                  src={luasMapImage}
                  alt="Luas Network Map showing Green and Red lines across Dublin"
                  className="w-full h-auto rounded-lg"
                />
              </div>
            </DialogContent>
          </Dialog>

          {/* Metrics */}
          <Link to="/metrics">
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            >
              <BarChart3 className="h-4 w-4" />
              <span className="hidden sm:inline">Metrics</span>
            </Button>
          </Link>

          {/* Hours */}
          <Link to="/hours">
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            >
              <Clock className="h-4 w-4" />
              <span className="hidden sm:inline">Hours</span>
            </Button>
          </Link>

          {/* Play */}
          <Link to="/tetris">
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            >
              <Gamepad2 className="h-4 w-4" />
              <span className="hidden sm:inline">Play</span>
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
