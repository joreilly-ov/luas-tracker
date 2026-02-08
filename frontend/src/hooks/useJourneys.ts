import { useState, useEffect } from 'react';
import { z } from 'zod';
import { Journey } from '@/types/journey';

const STORAGE_KEY = 'luas-journeys';

const JourneySchema = z.object({
  id: z.string(),
  line: z.enum(['green', 'red']),
  fromStation: z.string(),
  toStation: z.string(),
  date: z.string(),
  notes: z.string().optional()
});

const JourneysSchema = z.array(JourneySchema);

export function useJourneys() {
  const [journeys, setJourneys] = useState<Journey[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        const validated = JourneysSchema.parse(parsed) as Journey[];
        setJourneys(validated);
      } catch (error) {
        console.error('Invalid journey data in localStorage, clearing');
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  const saveJourneys = (newJourneys: Journey[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newJourneys));
    setJourneys(newJourneys);
  };

  const addJourney = (journey: Omit<Journey, 'id'>) => {
    const newJourney: Journey = {
      ...journey,
      id: crypto.randomUUID(),
    };
    saveJourneys([newJourney, ...journeys]);
  };

  const deleteJourney = (id: string) => {
    saveJourneys(journeys.filter(j => j.id !== id));
  };

  const stats = {
    totalRides: journeys.length,
    greenRides: journeys.filter(j => j.line === 'green').length,
    redRides: journeys.filter(j => j.line === 'red').length,
    uniqueStations: new Set(journeys.flatMap(j => [j.fromStation, j.toStation])).size,
  };

  return { journeys, addJourney, deleteJourney, stats };
}
