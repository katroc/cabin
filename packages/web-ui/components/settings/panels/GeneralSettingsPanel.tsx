'use client'

import { SettingField } from '../SettingField'
import { SettingControl } from '../SettingControl'
import { useSettings } from '../SettingsProvider'

export function GeneralSettingsPanel() {
  const { state, updateSetting } = useSettings()

  return (
    <div className="space-y-6">
      <SettingField
        title="Appearance"
        description="Customize the visual appearance of the application"
      >
        <SettingControl
          type="select"
          id="theme"
          label="Theme"
          value={state.data.theme}
          onChange={(value) => updateSetting('theme', value)}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' }
          ]}
          description="Choose between light and dark theme"
          error={state.validationErrors.theme}
        />
      </SettingField>

      <SettingField
        title="Logging"
        description="Configure application logging and monitoring"
      >
        <SettingControl
          type="select"
          id="logLevel"
          label="Log Level"
          value={state.data.logLevel}
          onChange={(value) => updateSetting('logLevel', value)}
          options={[
            { value: 'DEBUG', label: 'Debug' },
            { value: 'INFO', label: 'Info' },
            { value: 'WARNING', label: 'Warning' },
            { value: 'ERROR', label: 'Error' },
            { value: 'CRITICAL', label: 'Critical' }
          ]}
          description="Set the minimum level for log messages"
          error={state.validationErrors.logLevel}
        />
      </SettingField>

      <SettingField
        title="Metrics & Analytics"
        description="Control data collection and performance tracking"
      >
        <SettingControl
          type="toggle"
          id="metricsEnabled"
          label="Enable Metrics Collection"
          value={state.data.metricsEnabled}
          onChange={(value) => updateSetting('metricsEnabled', value)}
          description="Collect anonymous usage metrics to improve the application"
          error={state.validationErrors.metricsEnabled}
        />
      </SettingField>

      <SettingField
        title="Memory Management"
        description="Configure conversation memory and context handling"
      >
        <SettingControl
          type="slider"
          id="maxMemoryMessages"
          label="Max Memory Messages"
          value={state.data.maxMemoryMessages}
          onChange={(value) => updateSetting('maxMemoryMessages', value)}
          min={1}
          max={50}
          step={1}
          formatValue={(value) => `${value} messages`}
          description="Maximum number of previous messages to keep in conversation memory"
          error={state.validationErrors.maxMemoryMessages}
        />
      </SettingField>
    </div>
  )
}