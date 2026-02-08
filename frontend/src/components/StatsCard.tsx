import { cn } from "@/lib/utils";

interface StatsCardProps {
  title: string;
  value: number | string;
  variant?: 'default' | 'green' | 'red';
  icon?: React.ReactNode;
}

export function StatsCard({ title, value, variant = 'default', icon }: StatsCardProps) {
  return (
    <div 
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-card p-6 transition-all duration-300 hover:scale-[1.02]",
        variant === 'green' && "border-luas-green/30 hover:glow-green",
        variant === 'red' && "border-luas-red/30 hover:glow-red"
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className={cn(
            "mt-2 text-4xl font-bold font-mono tracking-tight",
            variant === 'green' && "text-luas-green",
            variant === 'red' && "text-luas-red"
          )}>
            {value}
          </p>
        </div>
        {icon && (
          <div className={cn(
            "rounded-lg p-2",
            variant === 'green' && "bg-luas-green/10 text-luas-green",
            variant === 'red' && "bg-luas-red/10 text-luas-red",
            variant === 'default' && "bg-muted text-muted-foreground"
          )}>
            {icon}
          </div>
        )}
      </div>
      
      {/* Decorative gradient */}
      <div className={cn(
        "absolute -bottom-8 -right-8 h-24 w-24 rounded-full opacity-20 blur-2xl",
        variant === 'green' && "bg-luas-green",
        variant === 'red' && "bg-luas-red",
        variant === 'default' && "bg-primary"
      )} />
    </div>
  );
}
