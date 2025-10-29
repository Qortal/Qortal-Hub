import { Card, CardContent, Typography, Box, ButtonBase, Divider, useTheme } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import MovieIcon from '@mui/icons-material/Movie';
import { decodeIfEncoded } from '../../utils/decode';
import { useTranslation } from 'react-i18next';
import { VideoPlayer } from './VideoPlayer';

type VideoCardProps = {
  owner?: string;
  resourceData: { service: string; name: string; identifier: string };
  refresh: () => void;
  openExternal: () => void;
  external?: any;
  encryptionType?: string | false;
};

export const VideoCard = ({ owner, resourceData, refresh, openExternal, external, encryptionType }: VideoCardProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['auth', 'core', 'group', 'question', 'tutorial']);

  return (
    <Card sx={{ backgroundColor: theme.palette.background.default }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 16px 0px 16px' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <MovieIcon sx={{ color: theme.palette.text.primary }} />
          <Typography>VIDEO embed</Typography>
        </Box>

        <Box sx={{ alignItems: 'center', display: 'flex', gap: '10px' }}>
          <ButtonBase>
            <RefreshIcon onClick={refresh} sx={{ fontSize: '24px', color: theme.palette.text.primary }} />
          </ButtonBase>

          {external && (
            <ButtonBase>
              <OpenInNewIcon onClick={openExternal} sx={{ fontSize: '24px', color: theme.palette.text.primary }} />
            </ButtonBase>
          )}
        </Box>
      </Box>

      <Box sx={{ padding: '8px 16px 8px 16px' }}>
        {owner && (
          <Typography sx={{ fontSize: '12px' }}>
            {t('core:message.generic.created_by', { owner: decodeIfEncoded(owner), postProcess: 'capitalizeFirstChar' })}
          </Typography>
        )}

        <Typography sx={{ fontSize: '12px' }}>
          {encryptionType === 'private'
            ? t('core:message.generic.encrypted', { postProcess: 'capitalizeAll' })
            : encryptionType === 'group'
            ? t('group:message.generic.group_encrypted', { postProcess: 'capitalizeAll' })
            : t('core:message.generic.encrypted_not', { postProcess: 'capitalizeFirstChar' })}
        </Typography>
      </Box>

      <Divider sx={{ borderColor: 'rgb(255 255 255 / 10%)' }} />

      <CardContent>
        <VideoPlayer service={resourceData?.service} name={resourceData?.name} identifier={resourceData?.identifier} />
      </CardContent>
    </Card>
  );
};
