import React, { useContext, useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { Box, IconButton, Slider } from '@mui/material'
import { CircularProgress, Typography } from '@mui/material'
import { Key } from 'ts-key-enum'
import {
  PlayArrow,
  Pause,
  VolumeUp,
  Fullscreen,
  PictureInPicture, VolumeOff, Calculate
} from '@mui/icons-material'
import { styled } from '@mui/system'
import { Refresh } from '@mui/icons-material'

import { Menu, MenuItem } from '@mui/material'
import { MoreVert as MoreIcon } from '@mui/icons-material'
import { GlobalContext, getBaseApiReact } from '../../App'
import { resourceKeySelector } from '../../atoms/global'
import { useRecoilValue } from 'recoil'
const VideoContainer = styled(Box)`
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  margin: 0px;
  padding: 0px;
`

const VideoElement = styled('video')`
  width: 100%;
  height: auto;
  max-height: calc(100vh - 150px);
  background: rgb(33, 33, 33);
`

const ControlsContainer = styled(Box)`
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: space-between;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 8px;
  background-color: rgba(0, 0, 0, 0.6);
`

interface VideoPlayerProps {
  src?: string
  poster?: string
  name?: string
  identifier?: string
  service?: string
  autoplay?: boolean
  from?: string | null
  customStyle?: any
  user?: string
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  poster,
  name,
  identifier,
  service,
  autoplay = true,
  from = null,
  customStyle = {},
  node
}) => {

  const keyIdentifier = useMemo(()=> {
    
    if(name && identifier && service){
      return `${service}-${name}-${identifier}`
    } else {
      return undefined
    }
  }, [service, name, identifier])
  const download = useRecoilValue(resourceKeySelector(keyIdentifier));
  const { downloadResource } = useContext(GlobalContext);

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(1)
  const [mutedVolume, setMutedVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [progress, setProgress] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [canPlay, setCanPlay] = useState(false)
  const [startPlay, setStartPlay] = useState(false)
  const [isMobileView, setIsMobileView] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [anchorEl, setAnchorEl] = useState(null)
  const reDownload = useRef<boolean>(false)

  const resetVideoState = () => {
    // Reset all states to their initial values
    setPlaying(false);
    setVolume(1);
    setMutedVolume(1);
    setIsMuted(false);
    setProgress(0);
    setIsLoading(false);
    setCanPlay(false);
    setStartPlay(false);
    setIsMobileView(false);
    setPlaybackRate(1);
    setAnchorEl(null);
  
    // Reset refs to their initial values
    if (videoRef.current) {
      videoRef.current.pause(); // Ensure the video is paused
      videoRef.current.currentTime = 0; // Reset video progress
    }
    reDownload.current = false;
  };

  const src = useMemo(() => {
    if(name && identifier && service){
      return `${node || getBaseApiReact()}/arbitrary/${service}/${name}/${identifier}`
    } 
    return ''
  }, [service, name, identifier])

  useEffect(()=> {
    resetVideoState()
  }, [keyIdentifier])
  const resourceStatus = useMemo(() => {
    return download?.status || {}
  }, [download])

  const minSpeed = 0.25;
  const maxSpeed = 4.0;
  const speedChange = 0.25;

  const updatePlaybackRate = (newSpeed: number) => {
    if (videoRef.current) {
      if (newSpeed > maxSpeed || newSpeed < minSpeed)
        newSpeed = minSpeed
      videoRef.current.playbackRate = newSpeed
      setPlaybackRate(newSpeed)
    }
  }

  const increaseSpeed = (wrapOverflow = true) => {
    const changedSpeed = playbackRate + speedChange
    let newSpeed = wrapOverflow ? changedSpeed : Math.min(changedSpeed, maxSpeed)


    if (videoRef.current) {
      updatePlaybackRate(newSpeed);
    }
  }

  const decreaseSpeed = () => {
    if (videoRef.current) {
      updatePlaybackRate(playbackRate - speedChange);
    }
  }


  const togglePlay = async () => {
    if (!videoRef.current) return
    setStartPlay(true)
    if (!src || resourceStatus?.status !== 'READY') {
      ReactDOM.flushSync(() => {
        setIsLoading(true)
      })
      getSrc()
    }
    if (playing) {
      videoRef.current.pause()
    } else {
      videoRef.current.play()
    }
    setPlaying(!playing)
  }


  const onVolumeChange = (_: any, value: number | number[]) => {
    if (!videoRef.current) return
    videoRef.current.volume = value as number
    setVolume(value as number)
    setIsMuted(false)
  }

  const onProgressChange = (_: any, value: number | number[]) => {
    if (!videoRef.current) return
    videoRef.current.currentTime = value as number
    setProgress(value as number)
    if (!playing) {
      videoRef.current.play()
      setPlaying(true)
    }
  }

  const handleEnded = () => {
    setPlaying(false)
  }

  const updateProgress = () => {
    if (!videoRef.current) return
    setProgress(videoRef.current.currentTime)
  }

  const [isFullscreen, setIsFullscreen] = useState(false)

  const enterFullscreen = () => {
    if (!videoRef.current) return
    if (videoRef.current.requestFullscreen) {
      videoRef.current.requestFullscreen()
    }
  }

  const exitFullscreen = () => {
    if (document.exitFullscreen) {
      document.exitFullscreen()
    }
  }

  const toggleFullscreen = () => {
    isFullscreen ? exitFullscreen() : enterFullscreen()
  }


  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])



  const handleCanPlay = () => {
    setIsLoading(false)
    setCanPlay(true)
  }

  const getSrc = React.useCallback(async () => {
    if (!name || !identifier || !service) return
    try {
      downloadResource({
        name,
        service,
        identifier
      })
    } catch (error) { 
      console.error(error)
    }
  }, [identifier, name, service])




  function formatTime(seconds: number): string {
    seconds = Math.floor(seconds)
    let minutes: number | string = Math.floor(seconds / 60)
    let hours: number | string = Math.floor(minutes / 60)

    let remainingSeconds: number | string = seconds % 60
    let remainingMinutes: number | string = minutes % 60

    if (remainingSeconds < 10) {
      remainingSeconds = '0' + remainingSeconds
    }

    if (remainingMinutes < 10) {
      remainingMinutes = '0' + remainingMinutes
    }

    if (hours === 0) {
      hours = ''
    }
    else {
      hours = hours + ':'
    }

    return hours + remainingMinutes + ':' + remainingSeconds
  }

  const reloadVideo = () => {
    if (!videoRef.current) return
    const currentTime = videoRef.current.currentTime
    videoRef.current.src = src
    videoRef.current.load()
    videoRef.current.currentTime = currentTime
    if (playing) {
      videoRef.current.play()
    }
  }

  useEffect(() => {
    if (
      resourceStatus?.status === 'DOWNLOADED' &&
      reDownload?.current === false
    ) {
      getSrc()
      reDownload.current = true
    }
  }, [getSrc, resourceStatus])

  const handleMenuOpen = (event: any) => {
    setAnchorEl(event.currentTarget)
  }

  const handleMenuClose = () => {
    setAnchorEl(null)
  }

  useEffect(() => {
    const videoWidth = videoRef?.current?.offsetWidth
    if (videoWidth && videoWidth <= 600) {
      setIsMobileView(true)
    }
  }, [canPlay])

  const getDownloadProgress = (current: number, total: number) => {
    const progress = current / total * 100;
    return Number.isNaN(progress) ? '' : progress.toFixed(0) + '%'
  }
  const mute = () => {
    setIsMuted(true)
    setMutedVolume(volume)
    setVolume(0)
    if (videoRef.current) videoRef.current.volume = 0
  }
  const unMute = () => {
    setIsMuted(false)
    setVolume(mutedVolume)
    if (videoRef.current) videoRef.current.volume = mutedVolume
  }

  const toggleMute = () => {
    isMuted ? unMute() : mute();
  }

  const changeVolume = (volumeChange: number) => {
    if (videoRef.current) {
      const minVolume = 0;
      const maxVolume = 1;


      let newVolume = volumeChange + volume

      newVolume = Math.max(newVolume, minVolume)
      newVolume = Math.min(newVolume, maxVolume)

      setIsMuted(false)
      setMutedVolume(newVolume)
      videoRef.current.volume = newVolume
      setVolume(newVolume);
    }

  }
  const setProgressRelative = (secondsChange: number) => {
    if (videoRef.current) {
      const currentTime = videoRef.current?.currentTime
      const minTime = 0
      const maxTime = videoRef.current?.duration || 100

      let newTime = currentTime + secondsChange;
      newTime = Math.max(newTime, minTime)
      newTime = Math.min(newTime, maxTime)
      videoRef.current.currentTime = newTime;
      setProgress(newTime);
    }
  }

  const setProgressAbsolute = (videoPercent: number) => {
    if (videoRef.current) {
      videoPercent = Math.min(videoPercent, 100)
      videoPercent = Math.max(videoPercent, 0)
      const finalTime = videoRef.current?.duration * videoPercent / 100
      videoRef.current.currentTime = finalTime
      setProgress(finalTime);
    }
  }


  const keyboardShortcutsDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    e.preventDefault()

    switch (e.key) {
      case Key.Add: increaseSpeed(false); break;
      case '+': increaseSpeed(false); break;
      case '>': increaseSpeed(false); break;

      case Key.Subtract: decreaseSpeed(); break;
      case '-': decreaseSpeed(); break;
      case '<': decreaseSpeed(); break;

      case Key.ArrowLeft: {
        if (e.shiftKey) setProgressRelative(-300);
        else if (e.ctrlKey) setProgressRelative(-60);
        else if (e.altKey) setProgressRelative(-10);
        else setProgressRelative(-5);
      } break;

      case Key.ArrowRight: {
        if (e.shiftKey) setProgressRelative(300);
        else if (e.ctrlKey) setProgressRelative(60);
        else if (e.altKey) setProgressRelative(10);
        else setProgressRelative(5);
      } break;

      case Key.ArrowDown: changeVolume(-0.05); break;
      case Key.ArrowUp: changeVolume(0.05); break;
    }
  }

  const keyboardShortcutsUp = (e: React.KeyboardEvent<HTMLDivElement>) => {
    e.preventDefault()

    switch (e.key) {
      case ' ': togglePlay(); break;
      case 'm': toggleMute(); break;

      case 'f': enterFullscreen(); break;
      case Key.Escape: exitFullscreen(); break;

      case '0': setProgressAbsolute(0); break;
      case '1': setProgressAbsolute(10); break;
      case '2': setProgressAbsolute(20); break;
      case '3': setProgressAbsolute(30); break;
      case '4': setProgressAbsolute(40); break;
      case '5': setProgressAbsolute(50); break;
      case '6': setProgressAbsolute(60); break;
      case '7': setProgressAbsolute(70); break;
      case '8': setProgressAbsolute(80); break;
      case '9': setProgressAbsolute(90); break;
    }
  }

  return (
    <VideoContainer
      tabIndex={0}
      onKeyUp={keyboardShortcutsUp}
      onKeyDown={keyboardShortcutsDown}
      style={{
        padding: from === 'create' ? '8px' : 0,
        width: '100%',
        height: '100%',
      }}
    >
     
      {isLoading && (
        <Box
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={resourceStatus?.status === 'READY' ? '55px ' : 0}
          display="flex"
          justifyContent="center"
          alignItems="center"
          zIndex={25}
          bgcolor="rgba(0, 0, 0, 0.6)"
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
          }}
        >
          <CircularProgress color="secondary" />
         
            <Typography
              variant="subtitle2"
              component="div"
              sx={{
                color: 'white',
                fontSize: '15px',
                textAlign: 'center'
              }}
            >
              {resourceStatus?.status === 'REFETCHING' ? (
                <>
                  <>
                    {getDownloadProgress(resourceStatus?.localChunkCount, resourceStatus?.totalChunkCount)}
                  </>

                  <> Refetching data in 25 seconds</>
                </>
              ) : resourceStatus?.status === 'DOWNLOADED' ? (
                <>Download Completed: building tutorial video...</>
              ) : resourceStatus?.status !== 'READY' ? (
                <>
                  {getDownloadProgress(resourceStatus?.localChunkCount || 0, resourceStatus?.totalChunkCount || 100)}

                </>
              ) : (
                <>Fetching tutorial from the Qortal Network...</>
              )}
            </Typography>
         
        </Box>
      )}
      {((!src && !isLoading) || !startPlay) && (
        <Box
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          display="flex"
          justifyContent="center"
          alignItems="center"
          zIndex={500}
          bgcolor="rgba(0, 0, 0, 0.6)"
          onClick={() => {
            togglePlay()
          }}
          sx={{
            cursor: 'pointer'
          }}
        >
          <PlayArrow
            sx={{
              width: '50px',
              height: '50px',
              color: 'white'
            }}
          />
        </Box>
      )}
      <Box sx={{
        display: 'flex',
        flexGrow: 1,
        width: '100%',
        height: 'calc(100% - 60px)',
      }}>
      <VideoElement
        id={identifier}
        ref={videoRef}
        src={!startPlay ? '' : resourceStatus?.status === 'READY' ? src : ''}
        poster={!startPlay ? poster : ""}
        onTimeUpdate={updateProgress}
        autoPlay={autoplay}
        onClick={togglePlay}
        onEnded={handleEnded}
        // onLoadedMetadata={handleLoadedMetadata}
        onCanPlay={handleCanPlay}
        preload="metadata"
        style={{
          width: '100%',
          height: '100%',
          ...customStyle
        }}
      />
      </Box>
      <ControlsContainer
        sx={{
          position: 'relative',
          background: 'var(--bg-primary)',
          width: '100%',
          flexShrink: 0
        }}
      >
        {isMobileView && canPlay ? (
          <>
            <IconButton
              sx={{
                color: 'rgba(255, 255, 255, 0.7)'
              }}
              onClick={togglePlay}
            >
              {playing ? <Pause /> : <PlayArrow />}
            </IconButton>
            <IconButton
              sx={{
                color: 'rgba(255, 255, 255, 0.7)',
                marginLeft: '15px'
              }}
              onClick={reloadVideo}
            >
              <Refresh />
            </IconButton>
            <Slider
              value={progress}
              onChange={onProgressChange}
              min={0}
              max={videoRef.current?.duration || 100}
              sx={{ flexGrow: 1, mx: 2 }}
            />
            <IconButton
              edge="end"
              color="inherit"
              aria-label="menu"
              onClick={handleMenuOpen}
            >
              <MoreIcon />
            </IconButton>
            <Menu
              id="simple-menu"
              anchorEl={anchorEl}
              keepMounted
              open={Boolean(anchorEl)}
              onClose={handleMenuClose}
              PaperProps={{
                style: {
                  width: '250px'
                }
              }}
            >
              <MenuItem>
                <VolumeUp />
                <Slider
                  value={volume}
                  onChange={onVolumeChange}
                  min={0}
                  max={1}
                  step={0.01} />
              </MenuItem>
              <MenuItem onClick={() => increaseSpeed()}>
                <Typography
                  sx={{
                    color: 'rgba(255, 255, 255, 0.7)',
                    fontSize: '14px'
                  }}
                >
                  Speed: {playbackRate}x
                </Typography>
              </MenuItem>
              <MenuItem onClick={toggleFullscreen}>
                <Fullscreen />
              </MenuItem>
            </Menu>
          </>
        ) : canPlay ? (
          <>
            <IconButton
              sx={{
                color: 'rgba(255, 255, 255, 0.7)'
              }}
              onClick={togglePlay}
            >
              {playing ? <Pause /> : <PlayArrow />}
            </IconButton>
            <IconButton
              sx={{
                color: 'rgba(255, 255, 255, 0.7)',
                marginLeft: '15px'
              }}
              onClick={reloadVideo}
            >
              <Refresh />
            </IconButton>
            <Slider
              value={progress}
              onChange={onProgressChange}
              min={0}
              max={videoRef.current?.duration || 100}
              sx={{ flexGrow: 1, mx: 2, color: 'var(--Mail-Background)' }}
            />
            <Typography
              sx={{
                fontSize: '14px',
                marginRight: '5px',
                color: 'rgba(255, 255, 255, 0.7)',
                visibility:
                  !videoRef.current?.duration || !progress
                    ? 'hidden'
                    : 'visible',
                  flexShrink: 0
              }}
            >
              {progress && videoRef.current?.duration && formatTime(progress)}/
              {progress &&
                videoRef.current?.duration &&
                formatTime(videoRef.current?.duration)}
            </Typography>
            <IconButton
              sx={{
                color: 'rgba(255, 255, 255, 0.7)',
                marginRight: '10px'
              }}
              onClick={toggleMute}
            >
              {isMuted ? <VolumeOff /> : <VolumeUp />}
            </IconButton>
            <Slider
              value={volume}
              onChange={onVolumeChange}
              min={0}
              max={1}
              step={0.01}
              sx={{
                maxWidth: '100px',
                color: 'var(--Mail-Background)'
              }}
            />
            <IconButton
              sx={{
                color: 'rgba(255, 255, 255, 0.7)',
                fontSize: '14px',
                marginLeft: '5px'
              }}
              onClick={(e) => increaseSpeed()}
            >
              Speed: {playbackRate}x
            </IconButton>
            <IconButton
              sx={{
                color: 'rgba(255, 255, 255, 0.7)'
              }}
              onClick={toggleFullscreen}
            >
              <Fullscreen />
            </IconButton>
          </>
        ) : null}
      </ControlsContainer>
    </VideoContainer>
  )
}
