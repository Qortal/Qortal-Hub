import { Avatar } from '@mui/material';
import { useState } from 'react';
import { getBaseApiReactForAvatar } from '../../utils/globalApi';

type SidePanelAppIconProps = {
  name: string;
  size: number;
};

/** A Q-App's or website's picture, or its first letter until there is one. */
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
      sx={{ fontSize: size * 0.5, height: size, width: size }}
      variant="rounded"
    >
      {name.charAt(0).toUpperCase()}
    </Avatar>
  );
};
