'use client'

import { useState, useEffect } from 'react'

interface BaseSettingProps {
  id: string
  label: string
  description?: string
  error?: string
  disabled?: boolean
  onChange: (value: any) => void
}

interface SettingInputProps extends BaseSettingProps {
  type: 'text' | 'number' | 'password' | 'url'
  value: string | number
  placeholder?: string
  min?: number
  max?: number
  step?: number
}

interface SettingSliderProps extends BaseSettingProps {
  type: 'slider'
  value: number
  min: number
  max: number
  step: number
  formatValue?: (value: number) => string
}

interface SettingToggleProps extends BaseSettingProps {
  type: 'toggle'
  value: boolean
}

interface SettingSelectProps extends BaseSettingProps {
  type: 'select'
  value: string
  options: Array<{ value: string; label: string; disabled?: boolean }>
  loading?: boolean
  loadingText?: string
}

type SettingControlProps = SettingInputProps | SettingSliderProps | SettingToggleProps | SettingSelectProps

export function SettingControl(props: SettingControlProps) {
  const [internalValue, setInternalValue] = useState(props.value)
  const [isFocused, setIsFocused] = useState(false)

  // Sync internal value when external value changes
  useEffect(() => {
    setInternalValue(props.value)
  }, [props.value])

  const handleChange = (newValue: any) => {
    setInternalValue(newValue)
    props.onChange(newValue)
  }

  const handleBlur = () => {
    setIsFocused(false)
    // For inputs, validate and potentially trigger onChange again on blur
    if (props.type === 'text' || props.type === 'number' || props.type === 'password' || props.type === 'url') {
      props.onChange(internalValue)
    }
  }

  const baseClasses = `
    w-full transition-all duration-200 ease-in-out
    ${props.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
    ${props.error ? 'border-[color:var(--error)]' : ''}
  `

  if (props.type === 'slider') {
    const sliderProps = props as SettingSliderProps
    const percentage = ((Number(internalValue) - sliderProps.min) / (sliderProps.max - sliderProps.min)) * 100

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-[color:var(--text-secondary)]">
            {props.label}
          </span>
          <span className="text-sm font-mono text-[color:var(--text-primary)] bg-[color:var(--bg-tertiary)] px-2 py-1 rounded">
            {sliderProps.formatValue ? sliderProps.formatValue(Number(internalValue)) : internalValue}
          </span>
        </div>

        <div className="relative">
          <input
            type="range"
            id={props.id}
            min={sliderProps.min}
            max={sliderProps.max}
            step={sliderProps.step}
            value={internalValue}
            onChange={(e) => handleChange(Number(e.target.value))}
            disabled={props.disabled}
            className={`${baseClasses} h-2 bg-[color:var(--bg-tertiary)] rounded-lg appearance-none cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[color:var(--accent)]
              [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2
              [&::-webkit-slider-thumb]:border-[color:var(--bg-secondary)] [&::-webkit-slider-thumb]:shadow-md
              hover:[&::-webkit-slider-thumb]:scale-110 hover:[&::-webkit-slider-thumb]:shadow-lg
              [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
              [&::-moz-range-thumb]:bg-[color:var(--accent)] [&::-moz-range-thumb]:cursor-pointer
              [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[color:var(--bg-secondary)]
            `}
            style={{
              background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${percentage}%, var(--bg-tertiary) ${percentage}%, var(--bg-tertiary) 100%)`
            }}
          />
        </div>

        {props.description && (
          <p className="text-xs text-[color:var(--text-muted)] mt-1">
            {props.description}
          </p>
        )}

        {props.error && (
          <p className="text-xs text-[color:var(--error)] mt-1">
            {props.error}
          </p>
        )}
      </div>
    )
  }

  if (props.type === 'toggle') {
    const toggleProps = props as SettingToggleProps

    return (
      <div className="flex items-center justify-between space-y-1">
        <div className="flex-1">
          <label htmlFor={props.id} className="text-sm font-medium text-[color:var(--text-secondary)] cursor-pointer">
            {props.label}
          </label>
          {props.description && (
            <p className="text-xs text-[color:var(--text-muted)] mt-1">
              {props.description}
            </p>
          )}
          {props.error && (
            <p className="text-xs text-[color:var(--error)] mt-1">
              {props.error}
            </p>
          )}
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={Boolean(internalValue)}
          onClick={() => !props.disabled && handleChange(!internalValue)}
          disabled={props.disabled}
          className={`
            relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-in-out
            focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)] focus:ring-offset-2 focus:ring-offset-[color:var(--bg-secondary)]
            ${Boolean(internalValue) ? 'bg-[color:var(--accent)]' : 'bg-[color:var(--bg-tertiary)]'}
            ${props.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          <span
            className={`
              inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform duration-200 ease-in-out
              ${Boolean(internalValue) ? 'translate-x-6' : 'translate-x-1'}
            `}
          />
        </button>
      </div>
    )
  }

  if (props.type === 'select') {
    const selectProps = props as SettingSelectProps

    return (
      <div className="space-y-2">
        <label htmlFor={props.id} className="text-sm font-medium text-[color:var(--text-secondary)]">
          {props.label}
        </label>

        <select
          id={props.id}
          value={internalValue as string}
          onChange={(e) => handleChange(e.target.value)}
          disabled={props.disabled || selectProps.loading}
          className={`${baseClasses} input-base`}
        >
          {selectProps.loading && (
            <option value="">{selectProps.loadingText || 'Loading...'}</option>
          )}
          {selectProps.options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
        </select>

        {props.description && (
          <p className="text-xs text-[color:var(--text-muted)] mt-1">
            {props.description}
          </p>
        )}

        {props.error && (
          <p className="text-xs text-[color:var(--error)] mt-1">
            {props.error}
          </p>
        )}
      </div>
    )
  }

  // Default to input type
  const inputProps = props as SettingInputProps

  return (
    <div className="space-y-2">
      <label htmlFor={props.id} className="text-sm font-medium text-[color:var(--text-secondary)]">
        {props.label}
      </label>

      <input
        type={inputProps.type}
        id={props.id}
        value={internalValue}
        onChange={(e) => {
          const newValue = inputProps.type === 'number' ? Number(e.target.value) : e.target.value
          handleChange(newValue)
        }}
        onFocus={() => setIsFocused(true)}
        onBlur={handleBlur}
        placeholder={inputProps.placeholder}
        min={inputProps.min}
        max={inputProps.max}
        step={inputProps.step}
        disabled={props.disabled}
        className={`${baseClasses} input-base ${isFocused ? 'ring-2 ring-[color:var(--accent)] ring-opacity-25' : ''}`}
      />

      {props.description && (
        <p className="text-xs text-[color:var(--text-muted)] mt-1">
          {props.description}
        </p>
      )}

      {props.error && (
        <p className="text-xs text-[color:var(--error)] mt-1">
          {props.error}
        </p>
      )}
    </div>
  )
}