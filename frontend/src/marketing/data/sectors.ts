// Sector selector tiles ("işletmenize uygun"). Phase 1 links to the homepage
// module grid anchor; dedicated sector pages are future scope.

export interface Sector {
  title: string;
  emoji: string;
  anchor: string;
}

export const SECTORS: Sector[] = [
  { title: "Restoran", emoji: "🍽️", anchor: "#moduller" },
  { title: "Kafe", emoji: "☕", anchor: "#moduller" },
  { title: "Bar", emoji: "🍸", anchor: "#moduller" },
  { title: "Pastane & Fırın", emoji: "🥐", anchor: "#moduller" },
  { title: "Fast Food", emoji: "🍔", anchor: "#moduller" },
  { title: "Pizza", emoji: "🍕", anchor: "#moduller" },
  { title: "Şubeli İşletme", emoji: "🏙️", anchor: "#coklu-sube" },
  { title: "Bulut Mutfak", emoji: "🛵", anchor: "#entegrasyonlar" },
];
