/**
 * Label Component
 * 
 * Form label component
 */

import { LabelHTMLAttributes } from 'react';

export function Label({ children, className = '', ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={`block text-sm font-medium text-gray-700 ${className}`} {...props}>
      {children}
    </label>
  );
}
