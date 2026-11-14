import {
  ArrowLeftRight, Baby, BadgeEuro, Banknote, Beer, Bike, BookOpen, Briefcase, BriefcaseBusiness, Building2, Bus, Camera, Car,
  Cat, CircleEllipsis, CirclePlus, Cloud, Code, Coffee, Coins, Computer, Cpu, CreditCard, Dog, Droplets, Dumbbell, Film, Flame,
  Fuel, Gamepad2, Gift, GraduationCap, Hammer, HandCoins, HandHeart, Headphones, Heart, HeartPulse, House, Keyboard, Landmark,
  Monitor, Mountain, Music, Palette, PawPrint, Percent, PiggyBank, Pill, Pizza, Plane, Plug, Receipt, RefreshCw, Repeat,
  Scissors, ShieldCheck, Shirt, ShoppingBag, ShoppingCart, Smartphone, Sofa, Sparkles, Stethoscope, Tag, Tent, Ticket, Train,
  Trees, TrendingUp, Trophy, Tv, Umbrella, Users, Utensils, Wallet, Wifi, Wrench, Zap,
  type LucideIcon,
} from 'lucide-react';

// Icônes proposées pour les catégories, par nom (format Lucide, kebab-case,
// celui stocké en base). Une sélection plutôt que toute la bibliothèque : le
// bundle reste léger et le choix lisible. Les noms des catégories par défaut
// (seed) et quelques alias historiques y figurent.
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  // Quotidien
  'shopping-cart': ShoppingCart, utensils: Utensils, coffee: Coffee, pizza: Pizza, beer: Beer,
  'shopping-bag': ShoppingBag, shirt: Shirt, scissors: Scissors, sparkles: Sparkles, tag: Tag,
  // Logement et charges
  home: House, sofa: Sofa, hammer: Hammer, wrench: Wrench, plug: Plug, zap: Zap, flame: Flame, droplets: Droplets,
  wifi: Wifi, smartphone: Smartphone, 'shield-check': ShieldCheck, umbrella: Umbrella, receipt: Receipt,
  // Transport
  car: Car, fuel: Fuel, bus: Bus, train: Train, bike: Bike, plane: Plane,
  // Santé et famille
  'heart-pulse': HeartPulse, stethoscope: Stethoscope, pill: Pill, baby: Baby, users: Users, heart: Heart,
  'paw-print': PawPrint, dog: Dog, cat: Cat,
  // Loisirs et culture
  'gamepad-2': Gamepad2, film: Film, tv: Tv, music: Music, headphones: Headphones, 'book-open': BookOpen,
  ticket: Ticket, camera: Camera, palette: Palette, dumbbell: Dumbbell, trophy: Trophy, mountain: Mountain,
  tent: Tent, trees: Trees, gift: Gift, 'hand-heart': HandHeart, 'graduation-cap': GraduationCap,
  // Numérique
  monitor: Monitor, computer: Computer, keyboard: Keyboard, cpu: Cpu, code: Code, cloud: Cloud, repeat: Repeat,
  // Argent
  wallet: Wallet, banknote: Banknote, coins: Coins, 'credit-card': CreditCard, 'piggy-bank': PiggyBank,
  'badge-euro': BadgeEuro, 'hand-coins': HandCoins, percent: Percent, 'trending-up': TrendingUp, landmark: Landmark,
  'building-2': Building2, briefcase: Briefcase, 'briefcase-business': BriefcaseBusiness, 'refresh-cw': RefreshCw,
  'arrow-left-right': ArrowLeftRight, 'plus-circle': CirclePlus, 'circle-ellipsis': CircleEllipsis,
};

// Anciens noms saisis à la main qui n'existent pas tels quels.
const ALIASES: Record<string, string> = { tools: 'wrench', house: 'home', 'circle-plus': 'plus-circle' };

export function categoryIcon(name: string | null | undefined): LucideIcon | null {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  return CATEGORY_ICONS[key] ?? CATEGORY_ICONS[ALIASES[key] ?? ''] ?? null;
}

/** Icône d'une catégorie (rien si aucune ou inconnue). */
export function CategoryIcon({ name, size = 16, className }: { name: string | null | undefined; size?: number; className?: string }) {
  const Icon = categoryIcon(name);
  return Icon ? <Icon size={size} strokeWidth={1.8} className={className} aria-hidden /> : null;
}
