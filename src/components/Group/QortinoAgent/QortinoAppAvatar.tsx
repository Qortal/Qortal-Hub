import { Avatar, Box, type SxProps, type Theme } from '@mui/material';
import { getBaseApiReact } from '../../../utils/globalApi';
import LogoSelected from '../../../assets/svgs/LogoSelected.svg';

/** A Q-App's or website's thumbnail in Qortino's answers; the Qortal logo while there is none. */
export function QortinoAppAvatar({
  alt,
  appName,
  sx,
}: {
  alt: string;
  appName: string;
  sx?: SxProps<Theme>;
}) {
  return (
    <Avatar
      alt={alt}
      imgProps={{ loading: 'lazy' }}
      src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${encodeURIComponent(appName)}/qortal_avatar?async=true`}
      sx={[
        { background: 'transparent', '& img': { objectFit: 'fill' } },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <Box
        alt=""
        component="img"
        src={LogoSelected}
        sx={{ height: 'auto', width: '62%' }}
      />
    </Avatar>
  );
}
