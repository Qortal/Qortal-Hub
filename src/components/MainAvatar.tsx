import { useContext, useEffect, useState } from 'react';
import Logo2 from '../assets/svgs/Logo2.svg';
import {
  QORTAL_APP_CONTEXT,
  getArbitraryEndpointReact,
  getBaseApiReact,
} from '../App';
import {
  Avatar,
  Box,
  Button,
  ButtonBase,
  Popover,
  Typography,
  useTheme,
} from '@mui/material';
import { Spacer } from '../common/Spacer';
import ImageUploader from '../common/ImageUploader';
import { getFee } from '../background/background.ts';
import { fileToBase64 } from '../utils/fileReading';
import { LoadingButton } from '@mui/lab';
import ErrorIcon from '@mui/icons-material/Error';
import { useTranslation } from 'react-i18next';

export const MainAvatar = ({ myName, balance, setOpenSnack, setInfoSnack }) => {
  const [hasAvatar, setHasAvatar] = useState(false);
  const [avatarFile, setAvatarFile] = useState(null);
  const [tempAvatar, setTempAvatar] = useState(null);
  const { show } = useContext(QORTAL_APP_CONTEXT);

  const [anchorEl, setAnchorEl] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  // Handle child element click to open Popover
  const handleChildClick = (event) => {
    event.stopPropagation(); // Prevent parent onClick from firing
    setAnchorEl(event.currentTarget);
  };

  // Handle closing the Popover
  const handleClose = () => {
    setAnchorEl(null);
  };

  // Determine if the popover is open
  const open = Boolean(anchorEl);
  const id = open ? 'avatar-img' : undefined;

  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  const checkIfAvatarExists = async () => {
    try {
      const identifier = `qortal_avatar`;
      const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=THUMBNAIL&identifier=${identifier}&limit=1&name=${myName}&includemetadata=false&prefix=true`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const responseData = await response.json();
      if (responseData?.length > 0) {
        setHasAvatar(true);
      }
    } catch (error) {
      console.log(error);
    }
  };
  useEffect(() => {
    if (!myName) return;
    checkIfAvatarExists();
  }, [myName]);

  const publishAvatar = async () => {
    try {
      const fee = await getFee('ARBITRARY');

      if (+balance < +fee.fee)
        throw new Error(
          t('core:message.generic.avatar_publish_fee', {
            fee: fee.fee,
            postProcess: 'capitalizeFirstChar',
          })
        );

      await show({
        message: t('core:message.question.publish_avatar', {
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: fee.fee + ' QORT',
      });

      setIsLoading(true);
      const avatarBase64 = await fileToBase64(avatarFile);

      await new Promise((res, rej) => {
        window
          .sendMessage('publishOnQDN', {
            data: avatarBase64,
            identifier: 'qortal_avatar',
            service: 'THUMBNAIL',
            uploadType: 'base64',
          })
          .then((response) => {
            if (!response?.error) {
              res(response);
              return;
            }
            rej(response.error);
          })
          .catch((error) => {
            rej(
              error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                })
            );
          });
      });
      setAvatarFile(null);
      setTempAvatar(`data:image/webp;base64,${avatarBase64}`);
      handleClose();
    } catch (error) {
      if (error?.message) {
        setOpenSnack(true);
        setInfoSnack({
          type: 'error',
          message: error?.message,
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (tempAvatar) {
    return (
      <>
        <Avatar
          sx={{
            height: '138px',
            width: '138px',
          }}
          src={tempAvatar}
          alt={myName}
        >
          {myName?.charAt(0)}
        </Avatar>

        <ButtonBase onClick={handleChildClick}>
          <Typography
            sx={{
              fontSize: '12px',
              opacity: 0.5,
            }}
          >
            {t('core:action.change_avatar', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </ButtonBase>

        <PopoverComp
          myName={myName}
          avatarFile={avatarFile}
          setAvatarFile={setAvatarFile}
          id={id}
          open={open}
          anchorEl={anchorEl}
          handleClose={handleClose}
          publishAvatar={publishAvatar}
          isLoading={isLoading}
        />
      </>
    );
  }

  if (hasAvatar) {
    return (
      <>
        <Avatar
          sx={{
            height: '138px',
            width: '138px',
          }}
          src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${myName}/qortal_avatar?async=true`}
          alt={myName}
        >
          {myName?.charAt(0)}
        </Avatar>

        <ButtonBase onClick={handleChildClick}>
          <Typography
            sx={{
              fontSize: '12px',
              opacity: 0.5,
            }}
          >
            {t('core:action.change_avatar', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </ButtonBase>

        <PopoverComp
          myName={myName}
          avatarFile={avatarFile}
          setAvatarFile={setAvatarFile}
          id={id}
          open={open}
          anchorEl={anchorEl}
          handleClose={handleClose}
          publishAvatar={publishAvatar}
          isLoading={isLoading}
        />
      </>
    );
  }

  return (
    <>
      <img src={Logo2} />
      <ButtonBase onClick={handleChildClick}>
        <Typography
          sx={{
            fontSize: '12px',
            opacity: 0.5,
          }}
        >
          {t('core:action.set_avatar', { postProcess: 'capitalizeFirstChar' })}
        </Typography>
      </ButtonBase>

      <PopoverComp
        myName={myName}
        avatarFile={avatarFile}
        setAvatarFile={setAvatarFile}
        id={id}
        open={open}
        anchorEl={anchorEl}
        handleClose={handleClose}
        publishAvatar={publishAvatar}
        isLoading={isLoading}
      />
    </>
  );
};

// TODO the following part is the same as in GroupAvatar.tsx
const PopoverComp = ({
  avatarFile,
  setAvatarFile,
  id,
  open,
  anchorEl,
  handleClose,
  publishAvatar,
  isLoading,
  myName,
}) => {
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  return (
    <Popover
      id={id}
      open={open}
      anchorEl={anchorEl}
      onClose={handleClose} // Close popover on click outside
      anchorOrigin={{
        vertical: 'bottom',
        horizontal: 'center',
      }}
      transformOrigin={{
        vertical: 'top',
        horizontal: 'center',
      }}
    >
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography
          sx={{
            fontSize: '12px',
          }}
        >
          {t('core:message.generic.avatar_size', {
            size: 500, // TODO magic number
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>

        <ImageUploader onPick={(file) => setAvatarFile(file)}>
          <Button
            variant="contained"
            sx={{
              backgroundColor: theme.palette.other.positive,
              color: theme.palette.text.primary,
              fontWeight: 'bold',
              opacity: 0.7,
              '&:hover': {
                backgroundColor: theme.palette.other.positive,
                color: 'black',
                opacity: 1,
              },
            }}
          >
            {t('core:action.choose_image', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>
        </ImageUploader>

        {avatarFile?.name}

        <Spacer height="25px" />

        {!myName && (
          <Box
            sx={{
              display: 'flex',
              gap: '5px',
              alignItems: 'center',
            }}
          >
            <ErrorIcon
              sx={{
                color: theme.palette.text.primary,
              }}
            />
            <Typography>
              {t('group:message.generic.avatar_registered_name', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          </Box>
        )}

        <Spacer height="25px" />

        <LoadingButton
          loading={isLoading}
          disabled={!avatarFile || !myName}
          onClick={publishAvatar}
          variant="contained"
          sx={{
            backgroundColor: theme.palette.other.positive,
            color: theme.palette.text.primary,
            fontWeight: 'bold',
            opacity: 0.7,
            '&:hover': {
              backgroundColor: theme.palette.other.positive,
              color: 'black',
              opacity: 1,
            },
          }}
        >
          {t('group:action.publish_avatar', {
            postProcess: 'capitalizeFirstChar',
          })}
        </LoadingButton>
      </Box>
    </Popover>
  );
};
