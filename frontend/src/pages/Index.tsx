import { LiveArrivals } from "@/components/LiveArrivals";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-4 py-8">
        <section>
          <div className="flex items-center gap-2 mb-6">
            <div className="h-1 w-8 bg-primary rounded-full" />
            <h2 className="text-lg font-semibold text-foreground">Live Arrivals</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <LiveArrivals stopCode="cab" stopName="Cabra" line="green" />
            {/* Add more stops here in future */}
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
