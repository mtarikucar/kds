export enum PlatformType {
  TRENDYOL = 'TRENDYOL',
  YEMEKSEPETI = 'YEMEKSEPETI',
  GETIR = 'GETIR',
  MIGROS = 'MIGROS',
  FUUDY = 'FUUDY',
}

export const PlatformTypeLabels: Record<PlatformType, string> = {
  [PlatformType.TRENDYOL]: 'Trendyol Go',
  [PlatformType.YEMEKSEPETI]: 'Yemeksepeti',
  [PlatformType.GETIR]: 'Getir Yemek',
  [PlatformType.MIGROS]: 'Migros Hemen',
  [PlatformType.FUUDY]: 'Fuudy',
};

export const PlatformTypeLogos: Record<PlatformType, string> = {
  [PlatformType.TRENDYOL]: '/logos/trendyol.svg',
  [PlatformType.YEMEKSEPETI]: '/logos/yemeksepeti.svg',
  [PlatformType.GETIR]: '/logos/getir.svg',
  [PlatformType.MIGROS]: '/logos/migros.svg',
  [PlatformType.FUUDY]: '/logos/fuudy.svg',
};

export const PlatformTypeColors: Record<PlatformType, string> = {
  [PlatformType.TRENDYOL]: '#F27A1A', // Trendyol Orange
  [PlatformType.YEMEKSEPETI]: '#FA0050', // Yemeksepeti Red
  [PlatformType.GETIR]: '#5D3EBC', // Getir Purple
  [PlatformType.MIGROS]: '#FF6600', // Migros Orange
  [PlatformType.FUUDY]: '#00B894', // Fuudy Green
};
