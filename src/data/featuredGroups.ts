export interface FeaturedGroup {
  id: number;
  name: string;
  description: string;
}

// Curated list of groups shown on the Home page (User tab).
// Group IDs and names must match real Qortal groups.
// Update IDs once confirmed; names are used to build logo URLs.
export const featuredGroups: FeaturedGroup[] = [
  {
    id: 694,
    name: 'Qortal',
    description: 'Official Qortal community group',
  },
  {
    id: 700,
    name: 'Qortal-General-Chat',
    description: 'General chat for the Qortal community',
  },
  {
    id: 706,
    name: 'Q-Apps',
    description: 'Discussion and support for Qortal Q-Apps',
  },
];
