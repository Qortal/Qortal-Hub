import type { ComponentType } from 'react';
import { Box } from '@mui/material';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import AccountBalanceRoundedIcon from '@mui/icons-material/AccountBalanceRounded';
import AppsRoundedIcon from '@mui/icons-material/AppsRounded';
import AutoStoriesRoundedIcon from '@mui/icons-material/AutoStoriesRounded';
import BuildRoundedIcon from '@mui/icons-material/BuildRounded';
import BusinessCenterRoundedIcon from '@mui/icons-material/BusinessCenterRounded';
import CabinRoundedIcon from '@mui/icons-material/CabinRounded';
import CategoryRoundedIcon from '@mui/icons-material/CategoryRounded';
import CheckroomRoundedIcon from '@mui/icons-material/CheckroomRounded';
import CodeRoundedIcon from '@mui/icons-material/CodeRounded';
import DesignServicesRoundedIcon from '@mui/icons-material/DesignServicesRounded';
import DirectionsCarRoundedIcon from '@mui/icons-material/DirectionsCarRounded';
import EventRoundedIcon from '@mui/icons-material/EventRounded';
import FaceRetouchingNaturalRoundedIcon from '@mui/icons-material/FaceRetouchingNaturalRounded';
import FavoriteRoundedIcon from '@mui/icons-material/FavoriteRounded';
import FlightRoundedIcon from '@mui/icons-material/FlightRounded';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import HealthAndSafetyRoundedIcon from '@mui/icons-material/HealthAndSafetyRounded';
import HistoryEduRoundedIcon from '@mui/icons-material/HistoryEduRounded';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import HowToVoteRoundedIcon from '@mui/icons-material/HowToVoteRounded';
import HubRoundedIcon from '@mui/icons-material/HubRounded';
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded';
import LabelOffRoundedIcon from '@mui/icons-material/LabelOffRounded';
import LocalCafeRoundedIcon from '@mui/icons-material/LocalCafeRounded';
import MapRoundedIcon from '@mui/icons-material/MapRounded';
import MemoryRoundedIcon from '@mui/icons-material/MemoryRounded';
import MenuBookRoundedIcon from '@mui/icons-material/MenuBookRounded';
import MovieRoundedIcon from '@mui/icons-material/MovieRounded';
import MusicNoteRoundedIcon from '@mui/icons-material/MusicNoteRounded';
import NewspaperRoundedIcon from '@mui/icons-material/NewspaperRounded';
import PaletteRoundedIcon from '@mui/icons-material/PaletteRounded';
import PetsRoundedIcon from '@mui/icons-material/PetsRounded';
import PhotoCameraRoundedIcon from '@mui/icons-material/PhotoCameraRounded';
import PrecisionManufacturingRoundedIcon from '@mui/icons-material/PrecisionManufacturingRounded';
import PsychologyAltRoundedIcon from '@mui/icons-material/PsychologyAltRounded';
import PsychologyRoundedIcon from '@mui/icons-material/PsychologyRounded';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import RestaurantRoundedIcon from '@mui/icons-material/RestaurantRounded';
import SchoolRoundedIcon from '@mui/icons-material/SchoolRounded';
import ScienceRoundedIcon from '@mui/icons-material/ScienceRounded';
import SelfImprovementRoundedIcon from '@mui/icons-material/SelfImprovementRounded';
import ShoppingBagRoundedIcon from '@mui/icons-material/ShoppingBagRounded';
import SpaRoundedIcon from '@mui/icons-material/SpaRounded';
import SportsEsportsRoundedIcon from '@mui/icons-material/SportsEsportsRounded';
import SportsSoccerRoundedIcon from '@mui/icons-material/SportsSoccerRounded';
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded';
import TheaterComedyRoundedIcon from '@mui/icons-material/TheaterComedyRounded';
import TranslateRoundedIcon from '@mui/icons-material/TranslateRounded';
import VideoLibraryRoundedIcon from '@mui/icons-material/VideoLibraryRounded';
import VolunteerActivismRoundedIcon from '@mui/icons-material/VolunteerActivismRounded';
import WbSunnyRoundedIcon from '@mui/icons-material/WbSunnyRounded';
import WidgetsRoundedIcon from '@mui/icons-material/WidgetsRounded';
import LogoSelected from '../../../assets/svgs/LogoSelected.svg';

/**
 * Themed icons for Core's categories (`/arbitrary/categories`). They follow the
 * text colour, unlike the emoji in `categoryIcons.ts`, which some Linux
 * systems draw as empty boxes.
 */
export const CATEGORY_ICON_COMPONENTS: Record<
  string,
  ComponentType<SvgIconProps>
> = {
  ART: PaletteRoundedIcon,
  AUTOMOTIVE: DirectionsCarRoundedIcon,
  BEAUTY: FaceRetouchingNaturalRoundedIcon,
  BOOKS: MenuBookRoundedIcon,
  BUSINESS: BusinessCenterRoundedIcon,
  COMMUNICATIONS: ForumRoundedIcon,
  // A distributed network, not one coin's logo.
  CRYPTOCURRENCY: HubRoundedIcon,
  CULTURE: TheaterComedyRoundedIcon,
  DATING: FavoriteRoundedIcon,
  DESIGN: DesignServicesRoundedIcon,
  ENTERTAINMENT: MovieRoundedIcon,
  EVENTS: EventRoundedIcon,
  FAITH: VolunteerActivismRoundedIcon,
  FASHION: CheckroomRoundedIcon,
  FINANCE: AccountBalanceRoundedIcon,
  FOOD: RestaurantRoundedIcon,
  GAMING: SportsEsportsRoundedIcon,
  GEOGRAPHY: PublicRoundedIcon,
  HEALTH: HealthAndSafetyRoundedIcon,
  HISTORY: HistoryEduRoundedIcon,
  HOME: HomeRoundedIcon,
  KNOWLEDGE: SchoolRoundedIcon,
  LANGUAGE: TranslateRoundedIcon,
  LIFESTYLE: LocalCafeRoundedIcon,
  MANUFACTURING: PrecisionManufacturingRoundedIcon,
  MAPS: MapRoundedIcon,
  MUSIC: MusicNoteRoundedIcon,
  NEWS: NewspaperRoundedIcon,
  OTHER: WidgetsRoundedIcon,
  PETS: PetsRoundedIcon,
  PHILOSOPHY: PsychologyAltRoundedIcon,
  PHOTOGRAPHY: PhotoCameraRoundedIcon,
  POLITICS: HowToVoteRoundedIcon,
  PRODUCE: Inventory2RoundedIcon,
  PRODUCTIVITY: TaskAltRoundedIcon,
  PSYCHOLOGY: PsychologyRoundedIcon,
  SCIENCE: ScienceRoundedIcon,
  SELF_CARE: SpaRoundedIcon,
  SELF_SUFFICIENCY: CabinRoundedIcon,
  SHOPPING: ShoppingBagRoundedIcon,
  SOCIAL: GroupsRoundedIcon,
  SOFTWARE: CodeRoundedIcon,
  SPIRITUALITY: SelfImprovementRoundedIcon,
  SPORTS: SportsSoccerRoundedIcon,
  STORYTELLING: AutoStoriesRoundedIcon,
  TECHNOLOGY: MemoryRoundedIcon,
  TOOLS: BuildRoundedIcon,
  TRAVEL: FlightRoundedIcon,
  UNCATEGORIZED: LabelOffRoundedIcon,
  VIDEO: VideoLibraryRoundedIcon,
  WEATHER: WbSunnyRoundedIcon,
};

/** The Qortal category shows the Qortal logo. */
const QORTAL_CATEGORY_ID = 'QORTAL';

interface CategoryIconProps {
  id?: string;
  size?: number;
  sx?: Record<string, any>;
}

/** A category's icon; `all` is every category, an unknown id a generic one. */
export const CategoryIcon = ({ id, size = 20, sx }: CategoryIconProps) => {
  const key = id?.toUpperCase();
  if (key === QORTAL_CATEGORY_ID) {
    return (
      <Box
        alt=""
        component="img"
        data-category-icon="QORTAL"
        draggable={false}
        src={LogoSelected}
        sx={{ flexShrink: 0, height: size, width: size, ...sx }}
      />
    );
  }
  const Icon =
    id === 'all'
      ? AppsRoundedIcon
      : (key && CATEGORY_ICON_COMPONENTS[key]) || CategoryRoundedIcon;
  return (
    <Icon
      aria-hidden
      sx={{ color: 'inherit', flexShrink: 0, fontSize: size, ...sx }}
    />
  );
};
