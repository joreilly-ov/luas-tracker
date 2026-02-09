/**
 * Official Luas stop-to-line mapping.
 * The backend sometimes returns incorrect line values, so the frontend
 * uses this authoritative lookup instead.
 */

const STOP_LINE_MAP: Record<string, "Green Line" | "Red Line"> = {
  // GREEN LINE (Broombridge → Brides Glen)
  "Broombridge": "Green Line",
  "Cabra": "Green Line",
  "Phibsborough": "Green Line",
  "Grangegorman": "Green Line",
  "Broadstone - University": "Green Line",
  "Dominick": "Green Line",
  "Parnell": "Green Line",
  "Marlborough": "Green Line",
  "Trinity": "Green Line",
  "O'Connell Upper": "Green Line",
  "O'Connell - GPO": "Green Line",
  "Westmoreland": "Green Line",
  "Dawson": "Green Line",
  "St. Stephen's Green": "Green Line",
  "Harcourt": "Green Line",
  "Charlemont": "Green Line",
  "Ranelagh": "Green Line",
  "Beechwood": "Green Line",
  "Cowper": "Green Line",
  "Milltown": "Green Line",
  "Windy Arbour": "Green Line",
  "Dundrum": "Green Line",
  "Balally": "Green Line",
  "Kilmacud": "Green Line",
  "Stillorgan": "Green Line",
  "Sandyford": "Green Line",
  "Central Park": "Green Line",
  "Glencairn": "Green Line",
  "The Gallops": "Green Line",
  "Leopardstown Valley": "Green Line",
  "Ballyogan Wood": "Green Line",
  "Carrickmines": "Green Line",
  "Laughanstown": "Green Line",
  "Cherrywood": "Green Line",
  "Brides Glen": "Green Line",

  // RED LINE (Saggart/Tallaght → The Point)
  "Saggart": "Red Line",
  "Tallaght": "Red Line",
  "Hospital": "Red Line",
  "Cookstown": "Red Line",
  "Fortunestown": "Red Line",
  "Citywest Campus": "Red Line",
  "Cheeverstown": "Red Line",
  "Fettercairn": "Red Line",
  "Belgard": "Red Line",
  "Kingswood": "Red Line",
  "Red Cow": "Red Line",
  "Kylemore": "Red Line",
  "Bluebell": "Red Line",
  "Blackhorse": "Red Line",
  "Drimnagh": "Red Line",
  "Goldenbridge": "Red Line",
  "Suir Road": "Red Line",
  "Rialto": "Red Line",
  "Fatima": "Red Line",
  "James's": "Red Line",
  "Heuston": "Red Line",
  "Museum": "Red Line",
  "Smithfield": "Red Line",
  "Four Courts": "Red Line",
  "Jervis": "Red Line",
  "Abbey Street": "Red Line",
  "Busáras": "Red Line",
  "Connolly": "Red Line",
  "George's Dock": "Red Line",
  "Mayor Square - NCI": "Red Line",
  "Spencer Dock": "Red Line",
  "The Point": "Red Line",
};

/**
 * Returns the official Luas line for a given stop name, or null if not found.
 */
export function getOfficialLineForStopName(
  stopName: string
): "Green Line" | "Red Line" | null {
  return STOP_LINE_MAP[stopName] ?? null;
}
