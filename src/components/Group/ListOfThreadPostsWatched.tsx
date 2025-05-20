import { useEffect, useState } from 'react';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import IconButton from '@mui/material/IconButton';
import { executeEvent } from '../../utils/events';
import { Box, Typography } from '@mui/material';
import { Spacer } from '../../common/Spacer';
import { CustomLoader } from '../../common/CustomLoader';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { useTranslation } from 'react-i18next';

export const ListOfThreadPostsWatched = () => {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation(['auth', 'core', 'group']);

  const getPosts = async () => {
    try {
      await new Promise((res, rej) => {
        window
          .sendMessage('getThreadActivity', {})
          .then((response) => {
            if (!response?.error) {
              if (!response) {
                res(null);
                return;
              }
              const uniquePosts = response.reduce((acc, current) => {
                const x = acc.find(
                  (item) => item?.thread?.threadId === current?.thread?.threadId
                );
                if (!x) {
                  return acc.concat([current]);
                } else {
                  return acc;
                }
              }, []);
              setPosts(uniquePosts);
              res(uniquePosts);
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
    } catch (error) {
      console.log(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    getPosts();
  }, []);

  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          padding: '0px 20px',
          width: '322px',
        }}
      >
        <Typography
          sx={{
            fontSize: '13px',
            fontWeight: 600,
          }}
        >
          {t('group:thread_posts', {
            postProcess: 'capitalizeFirstChar',
          })}
          :
        </Typography>

        <Spacer height="10px" />
      </Box>

      <Box
        sx={{
          bgcolor: 'background.paper',
          borderRadius: '19px',
          display: 'flex',
          flexDirection: 'column',
          height: '250px',
          padding: '20px',
          width: '322px',
        }}
      >
        {loading && posts.length === 0 && (
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              width: '100%',
            }}
          >
            <CustomLoader />
          </Box>
        )}

        {!loading && posts.length === 0 && (
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              height: '100%',
              justifyContent: 'center',
              width: '100%',
            }}
          >
            <Typography
              sx={{
                fontSize: '11px',
                fontWeight: 400,
                color: 'rgba(255, 255, 255, 0.2)',
              }}
            >
              {t('group:message.generic.no_display', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          </Box>
        )}

        {posts?.length > 0 && (
          <List
            className="scrollable-container"
            sx={{
              bgcolor: 'background.paper',
              maxHeight: '300px',
              maxWidth: 360,
              overflow: 'auto',
              width: '100%',
            }}
          >
            {posts?.map((post) => {
              return (
                <ListItem
                  key={post?.thread?.threadId}
                  onClick={() => {
                    executeEvent('openThreadNewPost', {
                      data: post,
                    });
                  }}
                  disablePadding
                  secondaryAction={
                    <IconButton edge="end" aria-label="comments">
                      <VisibilityIcon
                        sx={{
                          color: 'red',
                        }}
                      />
                    </IconButton>
                  }
                >
                  <ListItemButton disableRipple role={undefined} dense>
                    <ListItemText
                      primary={t('core:new_post_in', {
                        title: post?.thread?.threadData?.title,
                        postProcess: 'capitalizeFirstChar',
                      })}
                    />
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
        )}
      </Box>
    </Box>
  );
};
