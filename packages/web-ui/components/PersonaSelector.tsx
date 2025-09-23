'use client'

import { Fragment } from 'react'
import { Listbox, Transition } from '@headlessui/react'
import { ChevronDownIcon } from '@heroicons/react/20/solid'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTheaterMasks } from '@fortawesome/free-solid-svg-icons'
import { PersonaType } from './contexts/UIPreferencesProvider'

interface PersonaSelectorProps {
  value: PersonaType
  onChange: (value: PersonaType) => void
}

const personas = [
  { id: 'standard' as PersonaType, name: 'Standard' },
  { id: 'direct' as PersonaType, name: 'Direct' },
  { id: 'eli5' as PersonaType, name: 'ELI5' },
]

export default function PersonaSelector({ value, onChange }: PersonaSelectorProps) {
  const selectedPersona = personas.find(persona => persona.id === value) || personas[0]

  return (
    <div className="flex items-center gap-1.5">
      <FontAwesomeIcon
        icon={faTheaterMasks}
        className="h-4 w-4"
        style={{
          color: 'var(--accent)',
          opacity: 0.4
        }}
      />
      <Listbox value={value} onChange={onChange}>
        <div className="relative">
          <Listbox.Button className="relative w-full cursor-pointer rounded-full bg-[var(--bg-tertiary)] border ui-border-light pl-2.5 pr-7 py-1.5 text-left text-xs ui-text-primary focus:outline-none focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-opacity-25">
            <span className="block truncate">{selectedPersona.name}</span>
            <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
              <ChevronDownIcon
                className="h-4 w-4 ui-text-secondary"
                aria-hidden="true"
              />
            </span>
          </Listbox.Button>
          <Transition
            as={Fragment}
            leave="transition ease-in duration-100"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <Listbox.Options className="absolute z-10 bottom-full mb-1 max-h-60 min-w-max w-full overflow-auto rounded-lg bg-[var(--bg-secondary)] border ui-border-light py-1 text-xs shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
              {personas.map((persona) => (
                <Listbox.Option
                  key={persona.id}
                  className={({ active }) =>
                    `relative cursor-pointer select-none py-2 pl-6 pr-4 ${
                      active ? 'bg-[var(--bg-hover)] ui-text-primary' : 'ui-text-primary'
                    }`
                  }
                  value={persona.id}
                >
                  {({ selected }) => (
                    <>
                      <span
                        className={`block truncate ${
                          selected ? 'font-medium' : 'font-normal'
                        }`}
                      >
                        {persona.name}
                      </span>
                      {selected ? (
                        <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-[var(--accent)]">
                          <div className="h-2 w-2 rounded-full bg-[var(--accent)]" aria-hidden="true" />
                        </span>
                      ) : null}
                    </>
                  )}
                </Listbox.Option>
              ))}
            </Listbox.Options>
          </Transition>
        </div>
      </Listbox>
    </div>
  )
}