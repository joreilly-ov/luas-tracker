import { useState } from "react";
import { Train, Clock, BarChart3, Gamepad2, Map } from "lucide-react";
import { Link } from "react-router-dom";
import { LiveArrivals } from "@/components/LiveArrivals";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import luasMapImage from "@/assets/luas-network-map.png";

const Index = () => {
  const [mapOpen, setMapOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Header - Luas Purple */}
      <header className="bg-primary text-primary-foreground">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-primary-foreground/10 rounded-lg p-2">
              <Train className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Cabra Luas Tracker</h1>
              <p className="text-xs opacity-80 hidden sm:block">Dublin Live Arrivals</p>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            {/* DART — beta */}
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

      <main className="container mx-auto px-4 py-8">
        {/* Live Arrivals Section */}
        <section>
          <div className="flex items-center gap-2 mb-6">
            <div className="h-1 w-8 bg-primary rounded-full" />
            <h2 className="text-lg font-semibold text-foreground">
              Live Arrivals
            </h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <LiveArrivals stopCode="cab" stopName="Cabra" line="green" />
            {/* Add more stops here in future */}
          </div>
        </section>
      </main>

      {/* Footer */}
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
