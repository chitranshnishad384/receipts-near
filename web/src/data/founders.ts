export type Founder = {
  handle: string;
  name: string;
  company: string;
  city: string;
  blurb: string;
  sampleArr: string;
  priceRaw: string;
};

/** Every field here is invented. These are not real people or companies. */
export const founders: Founder[] = [
  {
    handle: "lila-pender",
    name: "Lila Pender",
    company: "Kite & Column",
    city: "Portland",
    blurb: "Bookkeeping software for independent bookstores.",
    sampleArr: "$2.4M",
    priceRaw: "20000000",
  },
  {
    handle: "otto-bramble",
    name: "Otto Bramble",
    company: "Harbor Mint",
    city: "Halifax",
    blurb: "Bulk seaweed snacks sold to grocery co-ops.",
    sampleArr: "$900k",
    priceRaw: "12000000",
  },
  {
    handle: "june-okonkwo",
    name: "June Okonkwo",
    company: "Salt Route",
    city: "Accra",
    blurb: "Cold-chain shipping for regional fisheries.",
    sampleArr: "$3.1M",
    priceRaw: "30000000",
  },
  {
    handle: "nico-feld",
    name: "Nico Feld",
    company: "Lowlamp Studio",
    city: "Leipzig",
    blurb: "Repair manuals and parts for espresso machines.",
    sampleArr: "$150k",
    priceRaw: "5000000",
  },
  {
    handle: "sera-quill",
    name: "Sera Quill",
    company: "Brine Mail",
    city: "Cork",
    blurb: "A print newsletter for oyster farms.",
    sampleArr: "$640k",
    priceRaw: "8000000",
  },
];

export function founderByHandle(handle: string): Founder | undefined {
  return founders.find((founder) => founder.handle === handle);
}
