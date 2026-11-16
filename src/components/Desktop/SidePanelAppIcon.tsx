import { Avatar, Box } from '@mui/material';
import { useState } from 'react';
import LogoSelected from '../../assets/svgs/LogoSelected.svg';
import { getBaseApiReactForAvatar } from '../../utils/globalApi';

type SidePanelAppIconProps = {
  name: string;
  size: number;
};

/**
 * A Q-App's or website's picture, or the Qortal logo when it has none, as
 * the launcher's tiles and the tabs show it.
 */
export const SidePanelAppIcon = ({ name, size }: SidePanelAppIconProps) => {
  const [failed, setFailed] = useState(false);
  const src = failed
    ? undefined
    : `${getBaseApiReactForAvatar()}/arbitrary/THUMBNAIL/${encodeURIComponent(
        name
      )}/qortal_avatar?async=true`;
  return (
    <Avatar
      alt=""
      imgProps={{ onError: () => setFailed(true) }}
      src={src}
      sx={{ height: size, width: size }}
      variant="rounded"
    >
      <Box
        alt=""
        component="img"
        draggable={false}
        src={LogoSelected}
        sx={{ height: 'auto', width: '62%' }}
      />
    </Avatar>
  );
};
