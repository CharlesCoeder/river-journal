import "./_LinkedProviders.css"
const _cn14 = "is_Text font_body _col-color _fs-f-size-2 _ff-f-family ";
const _cn13 = "is_Text font_body _col-color9 _fs-f-size-2 _ff-f-family _tt-uppercase _ls-2px ";
const _cn12 = "is_View _fd-column _gap-c-space-3 _width-10037 ";
const _cn11 = "is_Separator is_View _btc-color2 _brc-color2 _borderBottomColor-color2 _borderLeftColor-color2 _shrink-1 _btw-0px _brw-0px _borderBottomWidth-1px _borderLeftWidth-0px _grow-1 _fb-0px _height-0px _maxH-0px _bbs-solid _bts-solid _bls-solid _brs-solid _tr-translateY-1736186894 ";
const _cn10 = "is_Text font_body _col-color9 _fs-f-size-2 _ff-f-family _cur-pointer _col-0hover-color ";
const _cn9 = "is_Text font_body _col-color _fs-f-size-1 _ff-f-family _fw-700 _tt-uppercase _ls-1--5px ";
const _cn8 = "is_Text font_body _col-color8 _fs-f-size-2 _ff-f-family ";
const _cn7 = "is_Text font_body _col-color _fs-f-size-5 _ff-f-family ";
const _cn6 = "is_Text font_body _fs-f-size-5 _ff-f-family _col-color _fw-600 ";
const _cn5 = "is_Text font_body _fs-f-size-5 _ff-f-family _col-color9 _fw-400 ";
const _cn4 = "is_View _fd-column _gap-c-space-1 ";
const _cn3 = "is_View _fd-row _gap-c-space-3 _items-center _grow-1 _shrink-1 _fb-0px ";
const _cn2 = "is_View _fd-row _pt-c-space-4 _pb-c-space-4 _items-center _justify-space-betwe3241 ";
const _cn = "is_View _fd-column ";
/**
 * LinkedProviders — Displays connected auth providers and action buttons.
 *
 * Renders based on identity + password status:
 *   - Google OAuth only, no password → "Add Password" button
 *   - Google OAuth + password → "Change Password" button
 *   - Email only → "Change Password" + "Connect Google" button
 *   - Both linked → both shown as connected
 */

import { useState, useCallback } from 'react';
import { YStack, XStack, Text, Separator } from '@my/ui';
import Svg, { Path } from 'react-native-svg';
import { Mail } from '@tamagui/lucide-icons';
import { useIdentityLinking } from 'app/hooks/useIdentityLinking';
import { AddPasswordForm } from './AddPasswordForm';
function GoogleLogo({
  size = 16
}: {
  size?: number;
}) {
  return <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <Path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <Path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <Path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </Svg>;
}
function ProviderRow({
  icon,
  label,
  status,
  isConnected,
  actionLabel,
  onAction
}: {
  icon: React.ReactNode;
  label: string;
  status: string;
  isConnected: boolean;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return <div className={_cn}>
      <div className={_cn2}>
        <div className={_cn3}>
          {icon}
          <div className={_cn4}>
            <span className={!isConnected ? _cn5 : isConnected ? _cn6 : _cn7}>
              {label}
            </span>
            <span className={_cn8}>
              {status}
            </span>
          </div>
        </div>
        {isConnected && !actionLabel && <span className={_cn9}>
            Connected
          </span>}
        {actionLabel && onAction && <span className={_cn10} onClick={onAction}>
            {actionLabel}
          </span>}
      </div>
      <div className={_cn11} />
    </div>;
}
export function LinkedProviders() {
  const {
    hasPassword,
    isGoogleLinked,
    isLoading,
    isLinkingGoogle,
    error,
    linkGoogle,
    refresh
  } = useIdentityLinking();
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const handlePasswordSuccess = useCallback(() => {
    setShowPasswordForm(false);
    refresh();
  }, [refresh]);
  if (showPasswordForm) {
    return <AddPasswordForm mode={hasPassword ? 'change' : 'add'} onSuccess={handlePasswordSuccess} onCancel={() => setShowPasswordForm(false)} />;
  }
  return <div className={_cn12}>
      <span className={_cn13}>
        Linked Accounts
      </span>

      <ProviderRow icon={<Mail size={16} color={isLoading ? '$color8' : hasPassword ? '$color' : '$color8'} />} label="Email / Password" status={isLoading ? 'Checking…' : hasPassword ? 'Password is set' : 'No password set'} isConnected={!isLoading && hasPassword} actionLabel={isLoading ? undefined : hasPassword ? 'Change Password' : 'Add Password'} onAction={isLoading ? undefined : () => setShowPasswordForm(true)} />

      <ProviderRow icon={<GoogleLogo />} label="Google" status={isLoading ? 'Checking…' : isGoogleLinked ? 'Account linked' : 'Not connected'} isConnected={!isLoading && isGoogleLinked} actionLabel={isLoading ? undefined : isLinkingGoogle ? 'Connecting…' : isGoogleLinked ? undefined : 'Connect'} onAction={isLoading || isLinkingGoogle ? undefined : isGoogleLinked ? undefined : linkGoogle} />

      {error && <span className={_cn14}>
          {error}
        </span>}
    </div>;
}