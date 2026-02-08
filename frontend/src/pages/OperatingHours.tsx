import { Train, Clock, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ScheduleItem {
  route: string;
  line: 'green' | 'red';
  times: {
    day: string;
    hours: string;
  }[];
}

const scheduleData: ScheduleItem[] = [
  {
    route: "Northbound from Brides Glen",
    line: "green",
    times: [
      { day: "Monday - Friday", hours: "05:30 - 00:00" },
      { day: "Saturday", hours: "06:30 - 00:00" },
      { day: "Sunday & Bank Holiday", hours: "07:00 - 23:00" },
    ],
  },
  {
    route: "Northbound from Sandyford",
    line: "green",
    times: [
      { day: "Monday - Friday", hours: "05:30 - 00:18" },
      { day: "Saturday", hours: "06:30 - 00:18" },
      { day: "Sunday & Bank Holiday", hours: "07:00 - 23:18" },
    ],
  },
  {
    route: "Southbound from Broombridge",
    line: "green",
    times: [
      { day: "Monday - Friday", hours: "05:30 - 00:17" },
      { day: "Saturday", hours: "06:30 - 00:17" },
      { day: "Sunday & Bank Holiday", hours: "07:00 - 23:17" },
    ],
  },
  {
    route: "Eastbound from Tallaght",
    line: "red",
    times: [
      { day: "Monday - Friday", hours: "05:30 - 00:00" },
      { day: "Saturday", hours: "06:30 - 00:18" },
      { day: "Sunday & Bank Holiday", hours: "07:00 - 23:00" },
    ],
  },
  {
    route: "Eastbound from Saggart",
    line: "red",
    times: [
      { day: "Monday - Friday", hours: "05:42 - 23:52" },
      { day: "Saturday", hours: "06:42 - 00:15" },
      { day: "Sunday & Bank Holiday", hours: "07:12 - 22:51" },
    ],
  },
  {
    route: "Westbound from The Point",
    line: "red",
    times: [
      { day: "Monday - Friday", hours: "05:30 - 00:30 (00:15 to Saggart)" },
      { day: "Saturday", hours: "06:30 - 00:30 (00:08 to Saggart)" },
      { day: "Sunday & Bank Holiday", hours: "07:00 - 23:30 (23:05 to Saggart)" },
    ],
  },
  {
    route: "Westbound from Connolly",
    line: "red",
    times: [
      { day: "Monday - Friday", hours: "07:10 - 19:31" },
      { day: "Saturday", hours: "09:14 - 18:39" },
      { day: "Sunday & Bank Holiday", hours: "15:12 - 19:03" },
    ],
  },
];

const OperatingHours = () => {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-primary text-primary-foreground">
        <div className="container mx-auto px-4 py-4 flex items-center gap-3">
          <Link to="/">
            <Button variant="ghost" size="icon" className="mr-2 text-primary-foreground hover:bg-primary-foreground/10">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="bg-primary-foreground/10 rounded-lg p-2">
            <Clock className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Operating Hours</h1>
            <p className="text-xs opacity-80">First & last tram times</p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Green Line Section */}
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-4 w-4 rounded-full bg-luas-green" />
            <h2 className="text-lg font-semibold text-foreground">Green Line</h2>
          </div>
          <div className="space-y-4">
            {scheduleData
              .filter((item) => item.line === "green")
              .map((item, index) => (
                <ScheduleCard key={index} item={item} />
              ))}
          </div>
        </section>

        {/* Red Line Section */}
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-4 w-4 rounded-full bg-luas-red" />
            <h2 className="text-lg font-semibold text-foreground">Red Line</h2>
          </div>
          <div className="space-y-4">
            {scheduleData
              .filter((item) => item.line === "red")
              .map((item, index) => (
                <ScheduleCard key={index} item={item} />
              ))}
          </div>
        </section>

        {/* Footer note */}
        <p className="text-center text-sm text-muted-foreground border border-primary rounded-lg py-3 px-4">
          For Operating Hours for each Luas Stop see{" "}
          <a
            href="https://www.luas.ie"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline hover:text-primary/80"
          >
            www.luas.ie
          </a>
        </p>
      </main>
    </div>
  );
};

function ScheduleCard({ item }: { item: ScheduleItem }) {
  const lineColor = item.line === "green" ? "luas-green" : "luas-red";

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div
        className={cn(
          "px-4 py-2 text-center font-medium text-white",
          item.line === "green" ? "bg-luas-green" : "bg-luas-red"
        )}
      >
        {item.route}
      </div>
      {/* Times */}
      <div className="bg-card p-4 space-y-2">
        {item.times.map((time, idx) => (
          <div key={idx} className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{time.day}:</span>
            <span className="font-mono font-medium text-foreground">{time.hours}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default OperatingHours;
