import { z } from "zod";

// --- Arrivals API ---

const ArrivalSchema = z.object({
  destination: z.string(),
  direction: z.string(),
  due_minutes: z.number(),
  due_time: z.string(),
});

export type Arrival = z.infer<typeof ArrivalSchema>;

export const ArrivalsResponseSchema = z.object({
  stop_code: z.string(),
  last_updated: z.string(),
  next_arrivals: z.array(ArrivalSchema),
});

export type ArrivalsData = z.infer<typeof ArrivalsResponseSchema>;

// --- Stops API ---

const StopSchema = z.object({
  code: z.string(),
  name: z.string(),
  line: z.string(),
});

export const StopsResponseSchema = z.object({
  stops: z.object({
    green: z.array(StopSchema),
    red: z.array(StopSchema),
  }),
});

// --- Accuracy / Metrics API ---

const DestinationAccuracySchema = z.object({
  destination: z.string(),
  direction: z.string(),
  measurements: z.number(),
  avg_accuracy_minutes: z.number(),
  best_case_minutes: z.number(),
  worst_case_minutes: z.number(),
});

export type DestinationAccuracy = z.infer<typeof DestinationAccuracySchema>;

export const MetricsResponseSchema = z.object({
  stop_code: z.string(),
  period_hours: z.number(),
  message: z.string().optional(),
  data: z.array(DestinationAccuracySchema),
  debug_info: z.unknown().optional(),
});

export type MetricsData = z.infer<typeof MetricsResponseSchema>;

// --- Health API ---

export const HealthResponseSchema = z.object({
  status: z.string(),
}).passthrough();

// --- Debug APIs ---

export const DatabaseDebugSchema = z.object({
  status: z.string(),
  healthy: z.boolean(),
}).passthrough();

export const CollectionDebugSchema = z.object({
  status: z.string(),
  healthy: z.boolean(),
}).passthrough();
