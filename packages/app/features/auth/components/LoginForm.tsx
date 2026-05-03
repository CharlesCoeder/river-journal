import "./_LoginForm.css"
const _cn10 = "is_View _grow-1 _shrink-1 _fb-0px _height-1px _bg-color3 ";
const _cn9 = "is_Text font_body _col-color7 _ff-f-family _fs-10px _ls-3px _tt-uppercase ";
const _cn8 = "is_View _grow-1 _shrink-1 _fb-0px _height-1px _bg-color3 ";
const _cn7 = "is_View _fd-row _items-center _gap-c-space-3 _width-10037 _mt-c-space-2 ";
const _cn6 = "is_Text font_body _col-color _fs-12px _ff-f-family _text-center ";
const _cn5 = "is_Text font_body _col-color _fs-12px _ff-f-family _mt-c-space-1 ";
const _cn4 = "is_View _fd-column ";
const _cn3 = "is_Text font_body _col-color _fs-12px _ff-f-family _mt-c-space-1 ";
const _cn2 = "is_View _fd-column ";
const _cn = "is_View _fd-column _gap-c-space-5 _width-10037 ";
/**
 * LoginForm component for email/password authentication
 * Design: bottom-border serif inputs, uppercase micro buttons, "or" divider
 */

import { useState, useCallback } from 'react';
import { YStack, XStack, Text, Spinner, View } from '@my/ui';
import { use$ } from '@legendapp/state/react';
import { DesignInput } from './DesignInput';
import { signInWithEmail } from 'app/utils';
import type { AuthFormObservable } from '../AuthScreen';
import { GoogleSignInButton } from './GoogleSignInButton';
interface AuthActions {
  setEmail: (email: string) => void;
  setPassword: (password: string) => void;
}
interface LoginFormProps {
  authForm$: AuthFormObservable;
  actions: AuthActions;
  onSuccess?: () => void;
  onSwitchToSignup?: () => void;
}
export function LoginForm({
  authForm$,
  actions,
  onSuccess,
  onSwitchToSignup
}: LoginFormProps) {
  const email = use$(authForm$.email);
  const password = use$(authForm$.password);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{
    email?: string;
    password?: string;
    general?: string;
  }>({});
  const validateEmail = useCallback((value: string): string | undefined => {
    if (!value.trim()) return 'Email is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Please enter a valid email address';
    return undefined;
  }, []);
  const handleEmailBlur = useCallback(() => {
    if (email) setErrors(prev => ({
      ...prev,
      email: validateEmail(email)
    }));
  }, [email, validateEmail]);
  const handleEmailChange = useCallback((value: string) => {
    actions.setEmail(value);
    if (errors.email) setErrors(prev => ({
      ...prev,
      email: undefined
    }));
  }, [actions, errors.email]);
  const handlePasswordChange = useCallback((value: string) => {
    actions.setPassword(value);
    if (errors.password || errors.general) setErrors(prev => ({
      ...prev,
      password: undefined,
      general: undefined
    }));
  }, [actions, errors.password, errors.general]);
  const handleSubmit = useCallback(async () => {
    setErrors({});
    const emailError = validateEmail(email);
    if (emailError) {
      setErrors({
        email: emailError
      });
      return;
    }
    if (!password) {
      setErrors({
        password: 'Password is required'
      });
      return;
    }
    setIsLoading(true);
    try {
      const {
        user,
        error
      } = await signInWithEmail(email, password);
      if (error) {
        setErrors({
          general: error
        });
        return;
      }
      if (user) onSuccess?.();
    } finally {
      setIsLoading(false);
    }
  }, [email, password, validateEmail, onSuccess]);
  const canSubmit = !!email && !!password && !isLoading;
  return <div className={_cn}>
      {/* Email */}
      <div className={_cn2}>
        <DesignInput value={email} onChangeText={handleEmailChange} onBlur={handleEmailBlur} placeholder="Email address" disabled={isLoading} autoComplete="email" onSubmitEditing={handleSubmit} />
        {errors.email && <span className={_cn3}>
            {errors.email}
          </span>}
      </div>

      {/* Password */}
      <div className={_cn4}>
        <DesignInput value={password} onChangeText={handlePasswordChange} placeholder="Password" secureTextEntry={!showPassword} disabled={isLoading} showToggle onToggleShow={() => setShowPassword(!showPassword)} autoComplete="current-password" onSubmitEditing={handleSubmit} />
        {errors.password && <span className={_cn5}>
            {errors.password}
          </span>}
      </div>

      {/* Error */}
      {errors.general && <span className={_cn6}>
          {errors.general}
        </span>}

      {/* Submit Button */}
      <XStack onPress={canSubmit ? handleSubmit : undefined} borderWidth={1} borderColor={canSubmit ? '$color' : '$color3'} paddingVertical="$3" justifyContent="center" cursor={canSubmit ? 'pointer' : 'not-allowed'} hoverStyle={canSubmit ? {
      backgroundColor: '$color'
    } : {}} marginTop="$3" group="submitBtn">
        {isLoading ? <Spinner /> : <Text fontFamily="$body" fontSize={12} letterSpacing={3} textTransform="uppercase" color={canSubmit ? '$color' : '$color7'} {...canSubmit ? {
        '$group-submitBtn-hover': {
          color: '$background'
        }
      } : {}}>
            Log In
          </Text>}
      </XStack>

      {/* "or" divider */}
      <div className={_cn7}>
        <div className={_cn8} />
        <span className={_cn9}>
          or
        </span>
        <div className={_cn10} />
      </div>

      {/* Google OAuth */}
      <GoogleSignInButton onSuccess={onSuccess} />

    </div>;
}