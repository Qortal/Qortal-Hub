import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  Box,
  Button,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from '@mui/material';
import { QORTAL_APP_CONTEXT, getBaseApiReact } from '../../App';
import { executeEvent } from '../../utils/events';
import { LoadingSnackbar } from '../Snackbar/LoadingSnackbar';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { getFee } from '../../background/background.ts';
import {
  QDN_DESCRIPTION_MAX_BYTES,
  QDN_TITLE_MAX_BYTES,
  limitQdnDescription,
  limitQdnTag,
  limitQdnTitle,
  utf8ByteLength,
} from '../../utils/qdnMetadataLimits';
import { useTranslation } from 'react-i18next';
import { useSetAtom } from 'jotai';
import { infoSnackGlobalAtom, openSnackGlobalAtom } from '../../atoms/global';
import { useSortedMyNames } from '../../hooks/useSortedMyNames';
import {
  EMPTY_PREFILL,
  PublishPrefill,
  loadPublishPrefill,
} from './appPublishPrefill';
import {
  PublishProfile,
  loadPublishProfile,
  prefillFromProfile,
  profileChangedSince,
  publishProfileKey,
  publishSignature,
  savePublishProfile,
} from './publishProfiles';
import { PublishSource } from './publishSource';
import { PublishSourcePicker, formatPublishDate } from './PublishSourcePicker';
import {
  ExtrasSummary,
  extrasPartCount,
  PagePart,
  PartsLeft,
  PublishExtras,
  PublishExtrasHandle,
  PublishPageExtras,
  publishPageExtras,
} from './AppPage/PublishPageExtras';
import { NameAvatar } from './AppPage/AppPageParts';
import { appPageErrorText } from './AppPage/appPageErrors';
import {
  FormSection,
  PublishPreviewCard,
  PublishSummaryCard,
} from './PublishFormParts';
import { inLauncherTab, useLauncherTabId } from './launcherTabs';

const TITLE_MAX_CHARS = 80;
const DESCRIPTION_MAX_CHARS = 240;
const TAG_MAX_CHARS = 20;

/**
 * Text state whose setter applies Core's metadata limit, so the form shows what
 * Core will keep: it cuts the title and description by UTF-8 bytes, not
 * characters (see utils/qdnMetadataLimits.ts).
 */
const useLimitedText = (limit: (value: string) => string) => {
  const [value, setValue] = useState('');
  const setLimited = useCallback(
    (next: string) => setValue(limit(next)),
    [limit]
  );
  return [value, setLimited] as const;
};

/** Two columns from this form width on. */
const WIDE_FORM = 980;

/**
 * The form's width. A hidden or collapsed container (display: none) measures
 * 0: the form keeps the width it last had, so it is laid out as it was when it
 * shows again.
 */
const useElementWidth = () => {
  const [width, setWidth] = useState(0);
  const [element, setElement] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!element) return;
    const measure = () => {
      const next = element.clientWidth;
      if (next > 0) setWidth(next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return { width, ref: setElement };
};

/** How much input each part of the form has had. */
interface InputCounts {
  /** Everything but the page parts: name, files and listing. */
  app: number;
  page: number;
  shots: number;
}

/**
 * Page parts that failed after their app went out. The form keeps them, to
 * publish them again without the app.
 */
interface LeftParts {
  app: { service: string; name: string };
  /** The app's signature, which the page's version describes. */
  signature: string;
  page: boolean;
  shots: boolean;
  /** What failed and why, in words. */
  message: string;
  /** Each part's input when it was last taken for a publish. */
  published: InputCounts;
}

interface AppPublishProps {
  categories: any;
  myAddress: any;
  myName: any;
  initialName?: string;
  initialAppType?: 'APP' | 'WEBSITE';
  isAppTypeLocked?: boolean;
  /** Opened from Update on a published app: the name can't be changed. */
  isUpdate?: boolean;
  /**
   * Told whether the form holds input that is not published yet, and false
   * when it closes: a launcher tab asks before it closes with some.
   */
  onUnsavedChange?: (hasUnsavedInput: boolean) => void;
}

export const AppPublish = ({
  categories,
  myAddress,
  myName,
  initialName = '',
  initialAppType = 'APP',
  isAppTypeLocked = false,
  isUpdate = false,
  onUnsavedChange,
}: AppPublishProps) => {
  const [names, setNames] = useState([]);
  const [name, setName] = useState(initialName);
  const [title, setTitle] = useLimitedText(limitQdnTitle);
  const [description, setDescription] = useLimitedText(limitQdnDescription);
  const [category, setCategory] = useState('');
  const [appType, setAppType] = useState(initialAppType);
  const [source, setSource] = useState<PublishSource | null>(null);
  // This PC's saved profile for the chosen name and type.
  const [profile, setProfile] = useState<PublishProfile | null>(null);
  const { show } = useContext(QORTAL_APP_CONTEXT);
  // In a launcher tab, the published app opens in its place.
  const launcherTabId = useLauncherTabId();
  const theme = useTheme();
  const { t, i18n } = useTranslation(['auth', 'core', 'group', 'question']);
  const [tag1, setTag1] = useLimitedText(limitQdnTag);
  const [tag2, setTag2] = useLimitedText(limitQdnTag);
  const [tag3, setTag3] = useLimitedText(limitQdnTag);
  const [tag4, setTag4] = useLimitedText(limitQdnTag);
  const [tag5, setTag5] = useLimitedText(limitQdnTag);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);
  // The form closes as the published app opens: what the publish did is told
  // by Hub's own snackbar, which stays.
  const setInfoSnackGlobal = useSetAtom(infoSnackGlobalAtom);
  const setOpenSnackGlobal = useSetAtom(openSnackGlobalAtom);
  const [isLoading, setIsLoading] = useState('');
  const [prefillPending, setPrefillPending] = useState(false);
  const [activeField, setActiveField] = useState<string | null>(null);
  // The latest prefill; an answer for an earlier name or type is dropped.
  const prefillRunRef = useRef(0);
  // Fields the user changed since that prefill started: it never overwrites them.
  const editedFieldsRef = useRef(new Set<string>());
  // Anything the user chose or typed since the form opened or last published.
  // What a prefill fills in is not counted.
  const [hasUnsavedInput, setHasUnsavedInput] = useState(false);
  // Counts the input, so a publish that ends later sees what came after it.
  const inputCountRef = useRef(0);
  const noteInput = () => {
    inputCountRef.current += 1;
    setHasUnsavedInput(true);
  };
  const markEdited = (field: string) => {
    editedFieldsRef.current.add(field);
    noteInput();
  };
  // The page parts' share of it, so a retry of some parts knows what it
  // publishes.
  const partInputRef = useRef<Record<PagePart, number>>({ page: 0, shots: 0 });
  const notePartInput = (part: PagePart) => {
    partInputRef.current[part] += 1;
    noteInput();
  };
  const inputCounts = (): InputCounts => {
    const { page, shots } = partInputRef.current;
    return { app: inputCountRef.current - page - shots, page, shots };
  };
  /** Whether the form has input that the publish taken at `published` left out. */
  const hasInputSince = (published: InputCounts) => {
    const now = inputCounts();
    return (
      now.app > published.app ||
      now.page > published.page ||
      now.shots > published.shots
    );
  };
  // Page parts that failed after the app went out, kept to publish again.
  const [leftParts, setLeftParts] = useState<LeftParts | null>(null);
  const retryingRef = useRef(false);
  // An app being published keeps its name and type until its page parts are
  // out: the page section would otherwise show another app's page.
  const [appPublishing, setAppPublishing] = useState(false);
  const onUnsavedChangeRef = useRef(onUnsavedChange);
  onUnsavedChangeRef.current = onUnsavedChange;
  useEffect(() => {
    onUnsavedChangeRef.current?.(hasUnsavedInput);
  }, [hasUnsavedInput]);
  useEffect(() => () => onUnsavedChangeRef.current?.(false), []);
  // Whether the form is still open (its tab closes it, and so does a sign-out).
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  // Screenshots, version and What's new, published right after the app.
  const pageExtrasRef = useRef<PublishExtrasHandle>(null);
  const [extrasSummary, setExtrasSummary] = useState<ExtrasSummary | null>(
    null
  );
  const [unitFee, setUnitFee] = useState<number | null>(null);
  const { width, ref: formRef } = useElementWidth();
  const wide = width >= WIDE_FORM;
  const maxFileSize = appType === 'APP' ? 50 * 1024 * 1024 : 400 * 1024 * 1024; // 50MB or 400MB
  const showError = (message: string) => {
    setInfoSnack({ type: 'error', message });
    setOpenSnack(true);
  };

  /** Fills in the form, except fields the user changed meanwhile. */
  const applyPrefill = (prefill: PublishPrefill) => {
    const edited = editedFieldsRef.current;
    const setters: [string, (value: string) => void, string][] = [
      ['title', setTitle, prefill.title.slice(0, TITLE_MAX_CHARS)],
      [
        'description',
        setDescription,
        prefill.description.slice(0, DESCRIPTION_MAX_CHARS),
      ],
      ['category', setCategory, prefill.category],
      ...[setTag1, setTag2, setTag3, setTag4, setTag5].map(
        (setTag, index) =>
          [
            `tag${index + 1}`,
            setTag,
            (prefill.tags[index] || '').slice(0, TAG_MAX_CHARS),
          ] as [string, (value: string) => void, string]
      ),
    ];
    setters.forEach(([field, setValue, value]) => {
      if (!edited.has(field)) setValue(value);
    });
  };

  useEffect(() => {
    if (!name || !appType) return;
    const run = ++prefillRunRef.current;
    editedFieldsRef.current = new Set();
    const controller = new AbortController();
    setPrefillPending(true);
    setProfile(null);

    Promise.all([
      loadPublishPrefill(getBaseApiReact(), appType, name, {
        signal: controller.signal,
      }),
      loadPublishProfile(publishProfileKey(myAddress, appType, name)),
    ])
      .then(([result, savedProfile]) => {
        if (run !== prefillRunRef.current) return;
        setProfile(savedProfile);
        // What this PC sent last time, when the network has nothing to give.
        const fromProfile = prefillFromProfile(savedProfile);
        applyPrefill(
          result.kind === 'found'
            ? result.prefill
            : (fromProfile ?? EMPTY_PREFILL)
        );
        if (result.kind === 'unavailable') {
          setInfoSnack({
            type: 'warning',
            message: t(
              fromProfile
                ? 'core:publish_update.filled_from_profile'
                : 'core:message.generic.app_details_unavailable',
              { postProcess: 'capitalizeFirstChar' }
            ),
          });
          setOpenSnack(true);
        }
      })
      .catch(() => {
        // Aborted: a newer name or type, or the form closed.
      })
      .finally(() => {
        if (run === prefillRunRef.current) setPrefillPending(false);
      });

    return () => controller.abort();
  }, [name, appType, myAddress]);

  const getNames = useCallback(async () => {
    if (!myAddress) return;
    try {
      setIsLoading(
        t('core:loading.generic', { postProcess: 'capitalizeFirstChar' })
      );
      const res = await fetch(
        `${getBaseApiReact()}/names/address/${myAddress}?limit=0`
      );
      const data = await res.json();
      setNames(data?.map((item) => item.name));
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading('');
    }
  }, [myAddress]);
  useEffect(() => {
    getNames();
  }, [getNames]);

  useEffect(() => {
    if (initialName) setName(initialName);
  }, [initialName]);

  useEffect(() => {
    let alive = true;
    Promise.resolve(getFee('ARBITRARY'))
      .then((fee) => {
        const value = Number(fee?.fee);
        if (alive && Number.isFinite(value)) setUnitFee(value);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const mySortedNames = useSortedMyNames(names, myName);
  const tagLabel = (number: number) =>
    t('core:tag_number', { number, postProcess: 'capitalizeFirstChar' });
  const activeTagInfo = useMemo(() => {
    switch (activeField) {
      case 'tag1':
        return { number: 1, length: tag1.length };
      case 'tag2':
        return { number: 2, length: tag2.length };
      case 'tag3':
        return { number: 3, length: tag3.length };
      case 'tag4':
        return { number: 4, length: tag4.length };
      case 'tag5':
        return { number: 5, length: tag5.length };
      default:
        return null;
    }
  }, [
    activeField,
    tag1.length,
    tag2.length,
    tag3.length,
    tag4.length,
    tag5.length,
  ]);

  /** What failed after the app went out, and why, in words. */
  const partsLeftText = (left: PartsLeft) =>
    t(
      left.extras.page
        ? left.extras.shots
          ? 'core:app_page.publish.left_both'
          : 'core:app_page.publish.left_page'
        : 'core:app_page.publish.left_shots',
      {
        // Never empty, and never an internal code such as SHOT_UNAVAILABLE.
        error: appPageErrorText(t, left.error, { inSentence: true }),
        postProcess: 'capitalizeFirstChar',
      }
    );

  /** Tells Hub's own snackbar what went out, which stays if the form closes. */
  const tellPublished = (leftText: string) => {
    setInfoSnackGlobal(
      leftText
        ? { type: 'warning', message: leftText }
        : {
            type: 'success',
            message: t('core:message.success.published', {
              postProcess: 'capitalizeFirstChar',
            }),
          }
    );
    setOpenSnackGlobal(true);
  };

  /** The app and its page are out: the app opens in the form's place. */
  const openPublishedApp = (app: { service: string; name: string }) => {
    setHasUnsavedInput(false);
    onUnsavedChangeRef.current?.(false);
    const dataObj = {
      name: app.name,
      service: app.service,
      metadata: {
        title: title,
        description: description,
        category: category,
      },
      created: Date.now(),
    };
    executeEvent('addTab', {
      data: inLauncherTab(dataObj, launcherTabId),
    });
  };

  const publishApp = async () => {
    // Publishing before the form is filled in would replace the app's details.
    if (prefillPending) return;
    // What the form holds now is what this publish takes.
    const taken = inputCounts();
    setAppPublishing(true);
    try {
      const file = source?.file;
      const data = {
        name,
        // Spaces alone are no title or description, as in the checklist.
        title: title.trim(),
        description: description.trim(),
        category,
        appType,
        file,
      };
      const requiredFields = [
        'name',
        'title',
        'description',
        'category',
        'appType',
        'file',
      ];

      // What's missing, in the words of the checklist beside Publish.
      const fieldLabels: Record<string, string> = {
        name: 'core:publish_form.check_name',
        title: 'core:publish_form.check_title',
        description: 'core:publish_form.check_description',
        category: 'core:publish_form.check_category',
        appType: 'core:app_service_type',
        file: 'core:publish_form.check_files',
      };
      const missingFields: string[] = [];
      requiredFields.forEach((field) => {
        if (!data[field]) {
          missingFields.push(
            t(fieldLabels[field], { postProcess: 'capitalizeFirstChar' })
          );
        }
      });
      if (missingFields.length > 0) {
        const missingFieldsString = missingFields.join(', ');
        const errorMsg = t('core:message.error.missing_fields', {
          fields: missingFieldsString,
          postProcess: 'capitalizeFirstChar',
        });
        throw new Error(errorMsg);
      }
      const extras = pageExtrasRef.current?.prepare() ?? null;
      const extraParts = extrasPartCount(extras);
      const fee = await getFee('ARBITRARY');

      await show({
        message: extraParts
          ? t('core:app_page.publish.confirm_with_page', {
              count: extraParts,
              postProcess: 'capitalizeFirstChar',
            })
          : t('core:message.question.publish_app', {
              postProcess: 'capitalizeFirstChar',
            }),
        publishFee: extraParts
          ? `${(Number(fee.fee) * (1 + extraParts)).toFixed(2)} QORT`
          : fee.fee + ' QORT',
      });
      setIsLoading(
        t('core:message.generic.publishing', {
          postProcess: 'capitalizeFirstChar',
        })
      );
      const response = await new Promise((res, rej) => {
        window
          .sendMessage('publishOnQDN', {
            data: file,
            service: appType,
            title,
            name,
            description,
            category,
            tag1,
            tag2,
            tag3,
            tag4,
            tag5,
            uploadType: 'zip',
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
      const signature = publishSignature(response);
      // The page parts go after the app; the ones that fail are given back.
      const left = await publishPageExtras(
        { service: appType, name },
        extras,
        signature || ''
      );
      const leftText = left ? partsLeftText(left) : '';
      tellPublished(leftText);
      const published: PublishProfile = {
        publishedAt: Date.now(),
        metadata: {
          title,
          description,
          category,
          tags: [tag1, tag2, tag3, tag4, tag5].filter(Boolean),
        },
        ...(source.path
          ? {
              source: {
                path: source.path,
                kind: source.kind,
                takenAt: source.takenAt,
              },
            }
          : {}),
        ...(signature ? { signature } : {}),
      };
      setProfile((current) => ({ ...current, ...published }));
      void savePublishProfile(
        publishProfileKey(myAddress, appType, name),
        published
      );
      // The form closed while its page parts went out: no tab opens.
      if (!isMountedRef.current) return;
      // Some of the page didn't go out: the form keeps it, still unsaved, to
      // publish it again without the app.
      if (left) {
        setLeftParts({
          app: { service: appType, name },
          signature: signature || '',
          page: !!left.extras.page,
          shots: !!left.extras.shots,
          message: leftText,
          published: taken,
        });
        return;
      }
      setLeftParts(null);
      // Input given while it was publishing isn't published: the form stays
      // with it, unsaved.
      if (hasInputSince(taken)) return;
      // What was typed is published now, before the app opens in the tab.
      openPublishedApp({ service: appType, name });
    } catch (error) {
      setInfoSnack({
        type: 'error',
        message:
          error?.message ||
          t('core:message.error.publish_app', {
            postProcess: 'capitalizeFirstChar',
          }),
      });
      setOpenSnack(true);
    } finally {
      setAppPublishing(false);
      setIsLoading('');
    }
  };

  /**
   * Publishes the page parts that failed after the app, as the form holds
   * them now, without the app. The app opens once nothing is left unpublished.
   */
  const retryLeftParts = async () => {
    const pending = leftParts;
    if (!pending || retryingRef.current) return;
    retryingRef.current = true;
    const taken = inputCounts();
    try {
      const prepared = pageExtrasRef.current?.prepare() ?? null;
      const extras: PublishExtras = {
        page: pending.page ? (prepared?.page ?? null) : null,
        shots: pending.shots ? (prepared?.shots ?? null) : null,
        pageWasRead: prepared?.pageWasRead,
      };
      // A part emptied since has nothing to publish: it is done.
      const parts = extrasPartCount(extras);
      if (parts) {
        const fee = await getFee('ARBITRARY');
        await show({
          message: t('core:app_page.publish.confirm_retry', {
            postProcess: 'capitalizeFirstChar',
          }),
          publishFee: `${(Number(fee.fee) * parts).toFixed(2)} QORT`,
        });
        setIsLoading(
          t('core:message.generic.publishing', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
      const left = parts
        ? await publishPageExtras(pending.app, extras, pending.signature)
        : null;
      const leftText = left ? partsLeftText(left) : '';
      if (parts) tellPublished(leftText);
      // The parts that went out now are published as the form held them.
      const published: InputCounts = {
        ...pending.published,
        ...(pending.page && !left?.extras.page ? { page: taken.page } : {}),
        ...(pending.shots && !left?.extras.shots ? { shots: taken.shots } : {}),
      };
      if (!isMountedRef.current) return;
      if (left) {
        setLeftParts({
          ...pending,
          page: !!left.extras.page,
          shots: !!left.extras.shots,
          message: leftText,
          published,
        });
        return;
      }
      setLeftParts(null);
      // Input given since, that none of this published, stays unsaved here.
      if (hasInputSince(published)) return;
      openPublishedApp(pending.app);
    } catch (error) {
      // Declined: the parts stay to try again, and nothing failed.
      if (error?.isCanceled) return;
      // The fee couldn't be read: the parts stay to try again.
      setInfoSnack({
        type: 'error',
        message:
          error?.message ||
          t('core:message.error.publish_app', {
            postProcess: 'capitalizeFirstChar',
          }),
      });
      setOpenSnack(true);
    } finally {
      retryingRef.current = false;
      setIsLoading('');
    }
  };

  const tags = [tag1, tag2, tag3, tag4, tag5];
  const tagSetters = [setTag1, setTag2, setTag3, setTag4, setTag5];
  const categoryName =
    categories?.find((item) => item?.id === category)?.name || '';
  const capital = { postProcess: 'capitalizeFirstChar' };
  const checklist = [
    {
      key: 'name',
      label: t('core:publish_form.check_name', capital),
      done: !!name,
    },
    {
      key: 'files',
      label: t('core:publish_form.check_files', capital),
      done: !!source,
    },
    {
      key: 'title',
      label: t('core:publish_form.check_title', capital),
      done: !!title.trim(),
    },
    {
      key: 'description',
      label: t('core:publish_form.check_description', capital),
      done: !!description.trim(),
    },
    {
      key: 'category',
      label: t('core:publish_form.check_category', capital),
      done: !!category,
    },
  ];
  const parts = [
    {
      key: 'app',
      label:
        appType === 'WEBSITE'
          ? t('core:publish_form.part_website', capital)
          : t('core:publish_form.part_app', capital),
    },
    ...(extrasSummary?.pageText
      ? [{ key: 'page', label: t('core:app_page.edit.part_page', capital) }]
      : []),
    ...(extrasSummary &&
    ['chosen', 'remove'].includes(extrasSummary.screenshots)
      ? [
          {
            key: 'shots',
            label: t('core:app_page.edit.part_screenshots', capital),
          },
        ]
      : []),
  ];
  const heading =
    isUpdate && name
      ? t('core:publish_update.title', { name, ...capital })
      : appType === 'WEBSITE'
        ? t('core:developer.publish_site', capital)
        : t('core:developer.publish_app', capital);

  const preview = (
    <PublishPreviewCard
      categoryName={categoryName}
      description={description}
      isWebsite={appType === 'WEBSITE'}
      name={name}
      shotUrls={extrasSummary?.shotUrls || []}
      // Each tag once, as the library shows them.
      tags={Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)))}
      title={title}
      version={extrasSummary?.version || ''}
    />
  );
  const leftNotice = leftParts && (
    <Alert
      action={
        <Button
          color="inherit"
          disabled={!!isLoading}
          onClick={retryLeftParts}
          size="small"
          sx={{ textTransform: 'none' }}
        >
          {t('core:retry', capital)}
        </Button>
      }
      severity="warning"
      sx={{ mb: 2 }}
    >
      {leftParts.message}
      <Box component="span" sx={{ display: 'block', mt: 0.5 }}>
        {t('core:app_page.publish.left_hint', capital)}
      </Box>
    </Alert>
  );
  const summary = (
    <PublishSummaryCard
      busy={!!isLoading}
      checklist={checklist}
      disabled={prefillPending}
      onPublish={publishApp}
      parts={parts}
      publishLabel={t('core:action.publish', capital)}
      unitFee={unitFee}
    />
  );

  const sections = (
    <Box sx={{ minWidth: 0 }}>
      <FormSection
        hint={t('core:message.generic.one_app_per_name', capital)}
        number={1}
        title={t('core:publish_form.section_name', capital)}
      >
        <Box
          sx={{
            alignItems: 'flex-start',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 2,
          }}
        >
          <TextField
            // Page parts still to publish belong to the app published here.
            disabled={isUpdate || !!leftParts || appPublishing}
            label={t('core:name_app', capital)}
            onChange={(event) => {
              noteInput();
              setName(event?.target.value);
            }}
            select
            SelectProps={{ displayEmpty: true }}
            InputLabelProps={{ shrink: true }}
            sx={{ flex: '1 1 260px' }}
            value={name}
          >
            <MenuItem value="">
              <em style={{ color: theme.palette.text.secondary }}>
                {t('core:action.select_name_app', capital)}
              </em>
            </MenuItem>
            {mySortedNames.map((item) => (
              <MenuItem key={item} value={item}>
                <Box
                  component="span"
                  sx={{ alignItems: 'center', display: 'flex', gap: 1 }}
                >
                  <NameAvatar decorative name={item} size={24} />
                  {item}
                </Box>
              </MenuItem>
            ))}
          </TextField>
          <ToggleButtonGroup
            aria-label={t('core:app_service_type', capital)}
            disabled={isAppTypeLocked || !!leftParts || appPublishing}
            exclusive
            onChange={(_, value) => {
              if (!value) return;
              noteInput();
              setAppType(value);
            }}
            sx={{
              '& .MuiToggleButton-root': {
                borderRadius: '12px',
                px: 2.5,
                textTransform: 'none',
              },
            }}
            value={appType}
          >
            <ToggleButton value="APP">
              {t('core:app_page.hero.type_app')}
            </ToggleButton>
            <ToggleButton value="WEBSITE">
              {t('core:website', capital)}
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </FormSection>

      <FormSection
        hint={t('core:private_apps.max_file_size', {
          size: maxFileSize / (1024 * 1024),
          ...capital,
        })}
        number={2}
        title={t('core:publish_form.section_files', capital)}
      >
        <PublishSourcePicker
          changedSince={profileChangedSince(profile)}
          maxSize={maxFileSize}
          onChange={(next) => {
            noteInput();
            setSource(next);
          }}
          onError={showError}
          savedSource={profile?.source}
          source={source}
        />
      </FormSection>

      <FormSection
        hint={t('core:publish_form.listing_hint', capital)}
        number={3}
        title={t('core:publish_form.section_listing', capital)}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            fullWidth
            FormHelperTextProps={{ sx: { textAlign: 'end' } }}
            helperText={`${utf8ByteLength(title)}/${QDN_TITLE_MAX_BYTES}`}
            inputProps={{ maxLength: TITLE_MAX_CHARS }}
            label={t('core:title', capital)}
            onBlur={() => setActiveField(null)}
            onChange={(event) => {
              markEdited('title');
              setTitle(event.target.value.slice(0, TITLE_MAX_CHARS));
            }}
            onFocus={() => setActiveField('title')}
            value={title}
          />
          <TextField
            fullWidth
            FormHelperTextProps={{ sx: { textAlign: 'end' } }}
            helperText={`${utf8ByteLength(description)}/${QDN_DESCRIPTION_MAX_BYTES}`}
            inputProps={{ maxLength: DESCRIPTION_MAX_CHARS }}
            label={t('core:description', capital)}
            minRows={2}
            multiline
            onBlur={() => setActiveField(null)}
            onChange={(event) => {
              markEdited('description');
              setDescription(
                event.target.value.slice(0, DESCRIPTION_MAX_CHARS)
              );
            }}
            onFocus={() => setActiveField('description')}
            value={description}
          />
          <TextField
            label={t('core:category', capital)}
            onChange={(event) => {
              markEdited('category');
              setCategory(event?.target.value);
            }}
            select
            SelectProps={{ displayEmpty: true }}
            InputLabelProps={{ shrink: true }}
            sx={{ maxWidth: 420 }}
            value={category}
          >
            <MenuItem value="">
              <em style={{ color: theme.palette.text.secondary }}>
                {t('core:action.select_category', capital)}
              </em>
            </MenuItem>
            {categories?.map((item) => (
              <MenuItem key={item?.id} value={item?.id}>
                {item?.name}
              </MenuItem>
            ))}
          </TextField>
          <Box>
            <Box
              sx={{
                alignItems: 'baseline',
                display: 'flex',
                justifyContent: 'space-between',
                mb: 1,
              }}
            >
              <Typography sx={{ fontSize: '14px', fontWeight: 600 }}>
                {t('core:tags', capital)}
              </Typography>
              <Typography sx={{ color: 'text.secondary', fontSize: '12px' }}>
                {activeTagInfo
                  ? `${tagLabel(activeTagInfo.number)}: ${activeTagInfo.length}/${TAG_MAX_CHARS}`
                  : t('core:publish_form.tags_hint', capital)}
              </Typography>
            </Box>
            <Box
              sx={{
                display: 'grid',
                gap: 1,
                gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
              }}
            >
              {tags.map((tag, index) => (
                <TextField
                  inputProps={{
                    'aria-label': tagLabel(index + 1),
                    maxLength: TAG_MAX_CHARS,
                  }}
                  key={index}
                  onBlur={() => setActiveField(null)}
                  onChange={(event) => {
                    markEdited(`tag${index + 1}`);
                    tagSetters[index](
                      event.target.value.slice(0, TAG_MAX_CHARS)
                    );
                  }}
                  onFocus={() => setActiveField(`tag${index + 1}`)}
                  placeholder={tagLabel(index + 1)}
                  size="small"
                  value={tag}
                />
              ))}
            </Box>
          </Box>
        </Box>
      </FormSection>

      <FormSection
        hint={t('core:app_page.publish.hint', capital)}
        number={4}
        title={t('core:app_page.publish.title', capital)}
      >
        <PublishPageExtras
          bare
          file={source?.file ?? null}
          name={name}
          onInput={notePartInput}
          onSummaryChange={setExtrasSummary}
          ref={pageExtrasRef}
          service={appType}
        />
      </FormSection>
    </Box>
  );

  return (
    <Box
      ref={formRef}
      sx={{
        height: '100%',
        overflowX: 'hidden',
        overflowY: 'auto',
        width: '100%',
      }}
    >
      <Box
        sx={{
          maxWidth: '1160px',
          mx: 'auto',
          pb: 6,
          pt: { xs: 3, sm: 4 },
          px: { xs: 2, sm: 3 },
        }}
      >
        <Box sx={{ mb: 3 }}>
          <Typography
            component="h1"
            sx={{
              fontSize: { xs: '24px', sm: '28px' },
              fontWeight: 750,
              letterSpacing: '-0.02em',
            }}
          >
            {heading}
          </Typography>
          {profile?.publishedAt ? (
            <Typography
              sx={{ color: theme.palette.text.secondary, fontSize: '13px' }}
            >
              {t('core:publish_update.last_published', {
                date: formatPublishDate(profile.publishedAt, i18n?.language),
                ...capital,
              })}
            </Typography>
          ) : (
            <Typography sx={{ color: 'text.secondary', fontSize: '14px' }}>
              {t('core:publish_form.intro', capital)}
            </Typography>
          )}
        </Box>

        {/* One tree for both layouts: the side column is a plain box when
            narrow, so nothing in the form is rebuilt when it gets wider or
            narrower. */}
        <Box
          sx={
            wide
              ? {
                  alignItems: 'start',
                  display: 'grid',
                  gap: 2.5,
                  gridTemplateColumns: 'minmax(0, 1fr) 340px',
                }
              : undefined
          }
        >
          {sections}
          <Box sx={wide ? { position: 'sticky', top: 16 } : undefined}>
            {preview}
            {leftNotice}
            {summary}
          </Box>
        </Box>
      </Box>

      <LoadingSnackbar
        open={!!isLoading || prefillPending}
        info={{
          message:
            isLoading ||
            t('core:loading.generic', { postProcess: 'capitalizeFirstChar' }),
        }}
      />
      <CustomizedSnackbars
        duration={3500}
        open={openSnack}
        setOpen={setOpenSnack}
        info={infoSnack}
        setInfo={setInfoSnack}
      />
    </Box>
  );
};
