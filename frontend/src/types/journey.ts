export type LuasLine = 'green' | 'red';

export interface Journey {
  id: string;
  line: LuasLine;
  fromStation: string;
  toStation: string;
  date: string;
  notes?: string;
}

export const GREEN_LINE_STATIONS = [
  "Broombridge",
  "Cabra",
  "Phibsborough",
  "Grangegorman",
  "Broadstone - DIT",
  "Dominick",
  "Parnell",
  "Marlborough",
  "Westmoreland",
  "O'Connell - GPO",
  "Trinity",
  "Dawson",
  "St. Stephen's Green",
  "Harcourt",
  "Charlemont",
  "Ranelagh",
  "Beechwood",
  "Cowper",
  "Milltown",
  "Windy Arbour",
  "Dundrum",
  "Balally",
  "Kilmacud",
  "Stillorgan",
  "Sandyford",
  "Central Park",
  "Glencairn",
  "The Gallops",
  "Leopardstown Valley",
  "Ballyogan Wood",
  "Carrickmines",
  "Laughanstown",
  "Cherrywood",
  "Bride's Glen"
];

export const RED_LINE_STATIONS = [
  "The Point",
  "Spencer Dock",
  "Mayor Square - NCI",
  "George's Dock",
  "Connolly",
  "Busáras",
  "Abbey Street",
  "Jervis",
  "Four Courts",
  "Smithfield",
  "Museum",
  "Heuston",
  "James's",
  "Fatima",
  "Rialto",
  "Suir Road",
  "Goldenbridge",
  "Drimnagh",
  "Blackhorse",
  "Bluebell",
  "Kylemore",
  "Red Cow",
  "Kingswood",
  "Belgard",
  "Cookstown",
  "Hospital",
  "Tallaght",
  "Fettercairn",
  "Cheeverstown",
  "Citywest Campus",
  "Fortunestown",
  "Saggart"
];
