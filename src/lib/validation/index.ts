import { installValidationMessages } from './messages';

// Applied once, as soon as any module uses the shared validation rules.
installValidationMessages();

export * from './fields';
export { installValidationMessages } from './messages';
