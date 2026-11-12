import { Alert, App, Button, Form, Input, Switch } from "antd";
import { Network, Wifi } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { testLocalProxy } from "@/services/api/local-proxy";
import {
  DEFAULT_LOCAL_PROXY_URL,
  normalizeLocalProxyUrl,
  useConfigStore,
} from "@/stores/use-config-store";

export function ConfigLocalProxy() {
  const { message } = App.useApp();
  const { t } = useTranslation();
  const [testing, setTesting] = useState(false);
  const config = useConfigStore((state) => state.config);
  const updateConfig = useConfigStore((state) => state.updateConfig);
  const [address, setAddress] = useState(config.proxyUrl);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    setAddress(config.proxyUrl);
  }, [config.proxyUrl]);

  useEffect(
    () => () => request.current?.abort(),
    [],
  );

  const testProxy = async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setTesting(true);
    try {
      message.success(
        t("config.proxy.available", {
          proxy: await testLocalProxy(
            normalizeLocalProxyUrl(address) || DEFAULT_LOCAL_PROXY_URL,
            { signal: controller.signal },
          ),
        }),
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        message.error(
          error instanceof Error
            ? error.message
            : t("config.proxy.unreachable"),
        );
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setTesting(false);
      }
    }
  };

  const normalizedAddress = normalizeLocalProxyUrl(address);

  return (
    <Form layout="vertical" requiredMark={false}>
      <section className="grid gap-4 rounded-md border border-stone-200 p-4 dark:border-stone-800">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-stone-100 dark:bg-stone-800">
              <Network className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              {t("config.proxy.title")}
            </div>
            <div className="mt-1 text-xs text-stone-500">
              {t("config.proxy.description")}
            </div>
          </div>
          </div>
          <Switch
            aria-label={t("config.proxy.title")}
            checked={config.proxyEnabled}
            onChange={(checked) => updateConfig("proxyEnabled", checked)}
          />
        </header>
        {config.proxyEnabled ? (
          <>
            <Alert
              className="m-0"
              type="info"
              showIcon
              message={t("config.proxy.startHint")}
            />
            <Form.Item
              label={t("config.proxy.address")}
              extra={t("config.proxy.addressDescription")}
              validateStatus={address.trim() && !normalizedAddress ? "error" : undefined}
              help={address.trim() && !normalizedAddress ? t("config.proxy.unreachable") : undefined}
              className="m-0"
            >
              <Input
                value={address}
                placeholder={DEFAULT_LOCAL_PROXY_URL}
                onChange={(event) => setAddress(event.target.value)}
                onBlur={(event) =>
                  (() => {
                    const normalized =
                      normalizeLocalProxyUrl(event.target.value) ||
                      DEFAULT_LOCAL_PROXY_URL;
                    setAddress(normalized);
                    updateConfig("proxyUrl", normalized);
                  })()
                }
                onPressEnter={(event) => {
                  event.preventDefault();
                  void testProxy();
                }}
                aria-invalid={Boolean(address.trim() && !normalizedAddress)}
              />
            </Form.Item>
            <Button
              className="w-fit"
              icon={<Wifi className="size-4" />}
              loading={testing}
              disabled={Boolean(address.trim() && !normalizedAddress)}
              onClick={() => void testProxy()}
            >
              {t("config.proxy.test")}
            </Button>
            <div className="mt-3 text-xs text-stone-500">
              {t("config.proxy.channelHint")}
            </div>
          </>
        ) : null}
      </section>
    </Form>
  );
}
