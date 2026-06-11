import {
    Card, CardBody, CardHeader, CardFooter,
    Button, ButtonGroup, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Tooltip,
} from '@nextui-org/react';
import { BiCollapseVertical, BiExpandVertical } from 'react-icons/bi';
import { BaseDirectory, readTextFile } from '@tauri-apps/api/fs';
import { sendNotification } from '@tauri-apps/api/notification';
import React, { useEffect, useState, useRef } from 'react';
import { writeText } from '@tauri-apps/api/clipboard';
import PulseLoader from 'react-spinners/PulseLoader';
import { TbTransformFilled } from 'react-icons/tb';
import { HiOutlineVolumeUp } from 'react-icons/hi';
import { semanticColors } from '@nextui-org/theme';
import toast, { Toaster } from 'react-hot-toast';
import { MdContentCopy } from 'react-icons/md';
import { useTranslation } from 'react-i18next';
import Database from 'tauri-plugin-sql-api';
import { GiCycle } from 'react-icons/gi';
import { useTheme } from 'next-themes';
import { useAtomValue } from 'jotai';
import { useSpring, animated } from '@react-spring/web';
import useMeasure from 'react-use-measure';

import * as builtinCollectionServices from '../../../../services/collection';
import { sourceLanguageAtom, targetLanguageAtom } from '../LanguageArea';
import { useConfig, useToastStyle, useVoice } from '../../../../hooks';
import { sourceTextAtom, detectLanguageAtom } from '../SourceArea';
import { invoke_plugin } from '../../../../utils/invoke_plugin';
import * as builtinServices from '../../../../services/translate';
import * as builtinTtsServices from '../../../../services/tts';
import { info, error as logError } from 'tauri-plugin-log-api';
import {
    INSTANCE_NAME_CONFIG_KEY,
    ServiceSourceType,
    getDisplayInstanceName,
    getServiceName,
    getServiceSouceType,
    whetherPluginService,
} from '../../../../utils/service_instance';
import useTranslate from './useTranslate';
import ResultContent from './ResultContent';

export default function TargetArea(props) {
    const { index, name, translateServiceInstanceList, pluginList, serviceInstanceConfigMap, ...drag } = props;

    const [currentTranslateServiceInstanceKey, setCurrentTranslateServiceInstanceKey] = useState(name);

    const [appFontSize] = useConfig('app_font_size', 16);
    const [collectionServiceList] = useConfig('collection_service_list', []);
    const [ttsServiceList] = useConfig('tts_service_list', ['lingva_tts']);
    const [autoCopy] = useConfig('translate_auto_copy', 'disable');
    const [hideWindow] = useConfig('translate_hide_window', false);
    const [clipboardMonitor] = useConfig('clipboard_monitor', false);
    const [translateSecondLanguage] = useConfig('translate_second_language', 'en');
    const [historyDisable] = useConfig('history_disable', false);
    const [hide, setHide] = useState(true);

    const sourceText = useAtomValue(sourceTextAtom);
    const sourceLanguage = useAtomValue(sourceLanguageAtom);
    const targetLanguage = useAtomValue(targetLanguageAtom);
    const detectLanguage = useAtomValue(detectLanguageAtom);

    const [ttsPluginInfo, setTtsPluginInfo] = useState();
    const { t } = useTranslation();
    const textAreaRef = useRef();
    const toastStyle = useToastStyle();
    const speak = useVoice();
    const theme = useTheme();

    // ── History ──────────────────────────────────────────────────────────

    const addToHistory = async (text, source, target, service, resultText) => {
        const db = await Database.load('sqlite:history.db');
        try {
            await db.execute(
                'INSERT into history (text, source, target, service, result, timestamp) VALUES ($1, $2, $3, $4, $5, $6)',
                [text, source, target, service, resultText, Date.now()]
            );
        } catch {
            await db.execute(
                'CREATE TABLE history(id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, source TEXT NOT NULL, target TEXT NOT NULL, service TEXT NOT NULL, result TEXT NOT NULL, timestamp INTEGER NOT NULL)'
            );
            await db.execute(
                'INSERT into history (text, source, target, service, result, timestamp) VALUES ($1, $2, $3, $4, $5, $6)',
                [text, source, target, service, resultText, Date.now()]
            );
        } finally {
            db.close();
        }
    };

    // ── Translate ─────────────────────────────────────────────────────────

    const {
        isLoading, result, error,
        setResult, setError,
        translate, translateBack, clearError,
    } = useTranslate({
        index,
        sourceText,
        sourceLanguage,
        targetLanguage,
        detectLanguage,
        serviceInstanceConfigMap,
        pluginList,
        historyDisable,
        autoCopy,
        hideWindow,
        clipboardMonitor,
        translateSecondLanguage,
        addToHistory,
        writeText,
        t,
    });

    useEffect(() => {
        if (error) {
            logError(`[${currentTranslateServiceInstanceKey}] error: ${error}`);
        }
    }, [error, currentTranslateServiceInstanceKey]);

    useEffect(() => {
        if (
            sourceText.trim() !== '' && sourceLanguage && targetLanguage &&
            autoCopy !== null && hideWindow !== null && clipboardMonitor !== null
        ) {
            if (autoCopy === 'source' && !clipboardMonitor) {
                writeText(sourceText).then(() => {
                    if (hideWindow) {
                        sendNotification({ title: t('common.write_clipboard'), body: sourceText });
                    }
                });
            }
            translate(currentTranslateServiceInstanceKey);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sourceText, sourceLanguage, targetLanguage, currentTranslateServiceInstanceKey]);

    // ── TTS ───────────────────────────────────────────────────────────────

    useEffect(() => {
        if (ttsServiceList && getServiceSouceType(ttsServiceList[0]) === ServiceSourceType.PLUGIN) {
            readTextFile(`plugins/tts/${getServiceName(ttsServiceList[0])}/info.json`, {
                dir: BaseDirectory.AppConfig,
            }).then((infoStr) => setTtsPluginInfo(JSON.parse(infoStr)));
        }
    }, [ttsServiceList]);

    const handleSpeak = async () => {
        const instanceKey = ttsServiceList[0];
        const source = getServiceName(instanceKey);
        if (getServiceSouceType(instanceKey) === ServiceSourceType.PLUGIN) {
            if (!(targetLanguage in ttsPluginInfo.language)) throw new Error('Language not supported');
            const [func, utils] = await invoke_plugin('tts', source);
            const data = await func(result, ttsPluginInfo.language[targetLanguage], {
                config: serviceInstanceConfigMap[instanceKey], utils,
            });
            speak(data);
        } else {
            const langEnum = builtinTtsServices[source].Language;
            if (!(targetLanguage in langEnum)) throw new Error('Language not supported');
            const data = await builtinTtsServices[source].tts(
                result, langEnum[targetLanguage],
                { config: serviceInstanceConfigMap[instanceKey] },
            );
            speak(data);
        }
    };

    // ── Animated collapse ─────────────────────────────────────────────────

    const [boundRef, bounds] = useMeasure({ scroll: true });
    const springs = useSpring({
        from: { height: 0 },
        to: { height: hide ? 0 : bounds.height },
    });

    // ── Render helpers ────────────────────────────────────────────────────

    function serviceIcon(instanceKey) {
        const key = getServiceName(instanceKey);
        if (whetherPluginService(instanceKey)) {
            return pluginList['translate'][key]?.icon;
        }
        return builtinServices[key]?.info?.icon;
    }

    function serviceLabel(instanceKey) {
        const key = getServiceName(instanceKey);
        const nameFn = () => whetherPluginService(instanceKey)
            ? pluginList['translate'][key]?.display
            : t(`services.translate.${key}.title`);
        return getDisplayInstanceName(
            (serviceInstanceConfigMap[instanceKey] ?? {})[INSTANCE_NAME_CONFIG_KEY],
            nameFn,
        );
    }

    return (
        <Card shadow='none' className='rounded-[10px]'>
            <Toaster />
            {/* ── Header: service selector + collapse ── */}
            <CardHeader
                className={`flex justify-between py-1 px-0 bg-content2 h-[30px] ${
                    hide ? 'rounded-[10px]' : 'rounded-t-[10px]'
                }`}
                {...drag}
            >
                <div className='flex'>
                    <Dropdown>
                        <DropdownTrigger>
                            <Button size='sm' variant='solid' className='bg-transparent'
                                startContent={<img src={serviceIcon(currentTranslateServiceInstanceKey)} className='h-[20px] my-auto' />}
                            >
                                <div className='my-auto'>{serviceLabel(currentTranslateServiceInstanceKey)}</div>
                            </Button>
                        </DropdownTrigger>
                        <DropdownMenu
                            aria-label='translate service'
                            className='max-h-[40vh] overflow-y-auto'
                            onAction={(key) => setCurrentTranslateServiceInstanceKey(key)}
                        >
                            {translateServiceInstanceList.map((instanceKey) => (
                                <DropdownItem key={instanceKey}
                                    startContent={<img src={serviceIcon(instanceKey)} className='h-[20px] my-auto' />}
                                >
                                    {serviceLabel(instanceKey)}
                                </DropdownItem>
                            ))}
                        </DropdownMenu>
                    </Dropdown>
                    <PulseLoader
                        loading={isLoading}
                        color={theme === 'dark' ? semanticColors.dark.default[500] : semanticColors.light.default[500]}
                        size={8}
                        cssOverride={{ display: 'inline-block', margin: 'auto', marginLeft: '20px' }}
                    />
                </div>
                <Button size='sm' isIconOnly variant='light' className='h-[20px] w-[20px]'
                    onPress={() => setHide(!hide)}
                >
                    {hide ? <BiExpandVertical className='text-[16px]' /> : <BiCollapseVertical className='text-[16px]' />}
                </Button>
            </CardHeader>

            {/* ── Body: result content ── */}
            <animated.div style={{ ...springs }}>
                <div ref={boundRef}>
                    <CardBody className={`p-[12px] pb-0 ${hide && 'h-0 p-0'}`}>
                        <ResultContent
                            result={result}
                            error={error}
                            appFontSize={appFontSize}
                            speak={speak}
                            textAreaRef={textAreaRef}
                        />
                    </CardBody>

                    {/* ── Footer: speak / copy / translate-back / retry / collection ── */}
                    <CardFooter className={`bg-content1 rounded-none rounded-b-[10px] flex px-[12px] p-[5px] ${hide && 'hidden'}`}>
                        <ButtonGroup>
                            <Tooltip content={t('translate.speak')}>
                                <Button isIconOnly variant='light' size='sm'
                                    isDisabled={typeof result !== 'string' || result === ''}
                                    onPress={() => handleSpeak().catch((e) => toast.error(e.toString(), { style: toastStyle }))}
                                >
                                    <HiOutlineVolumeUp className='text-[16px]' />
                                </Button>
                            </Tooltip>
                            <Tooltip content={t('translate.copy')}>
                                <Button isIconOnly variant='light' size='sm'
                                    isDisabled={typeof result !== 'string' || result === ''}
                                    onPress={() => writeText(result)}
                                >
                                    <MdContentCopy className='text-[16px]' />
                                </Button>
                            </Tooltip>
                            <Tooltip content={t('translate.translate_back')}>
                                <Button isIconOnly variant='light' size='sm'
                                    isDisabled={typeof result !== 'string' || result === ''}
                                    onPress={() => translateBack(result, currentTranslateServiceInstanceKey)}
                                >
                                    <TbTransformFilled className='text-[16px]' />
                                </Button>
                            </Tooltip>
                            <Tooltip content={t('translate.retry')}>
                                <Button isIconOnly variant='light' size='sm'
                                    className={`${error === '' && 'hidden'}`}
                                    onPress={() => { clearError(); setResult(''); translate(currentTranslateServiceInstanceKey); }}
                                >
                                    <GiCycle className='text-[16px]' />
                                </Button>
                            </Tooltip>
                            {collectionServiceList?.map((instanceKey) => (
                                <Button key={instanceKey} isIconOnly variant='light' size='sm'
                                    onPress={async () => {
                                        const src = getServiceName(instanceKey);
                                        try {
                                            if (getServiceSouceType(instanceKey) === ServiceSourceType.PLUGIN) {
                                                const [func, utils] = await invoke_plugin('collection', src);
                                                await func(sourceText.trim(), result.toString(), {
                                                    config: serviceInstanceConfigMap[instanceKey], utils,
                                                });
                                            } else {
                                                await builtinCollectionServices[src].collection(
                                                    sourceText, result,
                                                    { config: serviceInstanceConfigMap[instanceKey] },
                                                );
                                            }
                                            toast.success(t('translate.add_collection_success'), { style: toastStyle });
                                        } catch (e) {
                                            toast.error(e.toString(), { style: toastStyle });
                                        }
                                    }}
                                >
                                    <img
                                        src={
                                            getServiceSouceType(instanceKey) === ServiceSourceType.PLUGIN
                                                ? pluginList['collection'][getServiceName(instanceKey)]?.icon
                                                : builtinCollectionServices[getServiceName(instanceKey)]?.info?.icon
                                        }
                                        className='h-[16px] w-[16px]'
                                    />
                                </Button>
                            ))}
                        </ButtonGroup>
                    </CardFooter>
                </div>
            </animated.div>
        </Card>
    );
}
