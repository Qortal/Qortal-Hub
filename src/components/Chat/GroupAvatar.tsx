import { useCallback, useContext, useEffect, useState } from 'react';
import Logo2 from '../assets/svgs/Logo2.svg';
import {
  MyContext,
  getArbitraryEndpointReact,
  getBaseApiReact,
} from '../../App';
import {
  Avatar,
  Box,
  Button,
  ButtonBase,
  Popover,
  Typography,
  useTheme,
} from '@mui/material';
import { Spacer } from '../../common/Spacer';
import ImageUploader from '../../common/ImageUploader';
import { getFee } from '../../background';
import { fileToBase64 } from '../../utils/fileReading';
import { LoadingButton } from '@mui/lab';
import ErrorIcon from '@mui/icons-material/Error';

export const GroupAvatar = ({
  myName,
  balance,
  setOpenSnack,
  setInfoSnack,
  groupId,
}) => {
  const [hasAvatar, setHasAvatar] = useState(false);
  const [avatarFile, setAvatarFile] = useState(null);
  const [tempAvatar, setTempAvatar] = useState(null);
  const { show } = useContext(MyContext);

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

  const checkIfAvatarExists = useCallback(async (name, groupId) => {
    try {
      const identifier = `qortal_group_avatar_${groupId}`;
      const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=THUMBNAIL&identifier=${identifier}&limit=1&name=${name}&includemetadata=false&prefix=true`;
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
  }, []);
  useEffect(() => {
    if (!myName || !groupId) return;
    checkIfAvatarExists(myName, groupId);
  }, [myName, groupId, checkIfAvatarExists]);

  const publishAvatar = async () => {
    try {
      if (!groupId) return;
      const fee = await getFee('ARBITRARY');
      if (+balance < +fee.fee)
        throw new Error(`Publishing an Avatar requires ${fee.fee}`);
      await show({
        message: 'Would you like to publish an avatar?',
        publishFee: fee.fee + ' QORT',
      });
      setIsLoading(true);
      const avatarBase64 = await fileToBase64(avatarFile);
      await new Promise((res, rej) => {
        window
          .sendMessage('publishOnQDN', {
            data: avatarBase64,
            identifier: `qortal_group_avatar_${groupId}`,
            service: 'THUMBNAIL',
          })
          .then((response) => {
            if (!response?.error) {
              res(response);
              return;
            }
            rej(response.error);
          })
          .catch((error) => {
            rej(error.message || 'An error occurred');
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
              fontSize: '16px',
              opacity: 0.5,
            }}
          >
            change avatar
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
          src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${myName}/qortal_group_avatar_${groupId}?async=true`}
          alt={myName}
        >
          {myName?.charAt(0)}
        </Avatar>
        <ButtonBase onClick={handleChildClick}>
          <Typography
            sx={{
              fontSize: '16px',
              opacity: 0.5,
            }}
          >
            change avatar
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
            fontSize: '16px',
            opacity: 0.5,
          }}
        >
          set avatar
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
          (500 KB max. for GIFS){' '}
        </Typography>
        <ImageUploader onPick={(file) => setAvatarFile(file)}>
          <Button variant="contained">Choose Image</Button>
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
              A registered name is required to set an avatar
            </Typography>
          </Box>
        )}

        <Spacer height="25px" />
        <LoadingButton
          loading={isLoading}
          disabled={!avatarFile || !myName}
          onClick={publishAvatar}
          variant="contained"
        >
          Publish avatar
        </LoadingButton>
      </Box>
    </Popover>
  );
};
