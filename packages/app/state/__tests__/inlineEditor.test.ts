import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../../utils/supabase', () => ({
  supabase: {},
}))

import {
  ephemeral$,
  showInlineEditor,
  showPersistentEditor,
  hidePersistentEditor,
  setInlineEditorGeometry,
  expandInlineEditor,
  collapseInlineEditor,
  requestPersistentEditorBlur,
  setPersistentEditorFocused,
  clearPersistentEditorContent,
} from '../store'

beforeEach(() => {
  ephemeral$.persistentEditor.assign({
    isVisible: false,
    readOnly: false,
    initialContent: '',
    initialContentRevision: 0,
    headerHeight: 0,
    bottomBarHeight: 0,
    layoutMode: 'screen',
    inlineTop: 0,
    expandedTop: 0,
    insetX: 0,
    expanded: false,
    isFocused: false,
    blurRequest: 0,
  })
})

describe('showInlineEditor', () => {
  it('shows the editor collapsed in inline layout with the given content', () => {
    showInlineEditor({ content: 'hello' })
    const s = ephemeral$.persistentEditor.get()
    expect(s.isVisible).toBe(true)
    expect(s.readOnly).toBe(false)
    expect(s.layoutMode).toBe('inline')
    expect(s.expanded).toBe(false)
    expect(s.initialContent).toBe('hello')
  })

  it('showPersistentEditor always resets to screen layout', () => {
    showInlineEditor()
    expandInlineEditor()
    showPersistentEditor({ content: 'x' })
    const s = ephemeral$.persistentEditor.get()
    expect(s.layoutMode).toBe('screen')
    expect(s.expanded).toBe(false)
  })
})

describe('setInlineEditorGeometry', () => {
  it('rounds and stores only the fields provided', () => {
    setInlineEditorGeometry({ inlineTop: 312.4, insetX: 23.6 })
    let s = ephemeral$.persistentEditor.get()
    expect(s.inlineTop).toBe(312)
    expect(s.insetX).toBe(24)
    expect(s.expandedTop).toBe(0)

    setInlineEditorGeometry({ expandedTop: 60.2 })
    s = ephemeral$.persistentEditor.get()
    expect(s.expandedTop).toBe(60)
    expect(s.inlineTop).toBe(312)
  })
})

describe('expand / collapse', () => {
  it('expandInlineEditor sets expanded without touching the blur counter', () => {
    expandInlineEditor()
    expect(ephemeral$.persistentEditor.expanded.get()).toBe(true)
    expect(ephemeral$.persistentEditor.blurRequest.get()).toBe(0)
  })

  it('collapseInlineEditor clears expanded and asks the WebView to blur', () => {
    expandInlineEditor()
    collapseInlineEditor()
    expect(ephemeral$.persistentEditor.expanded.get()).toBe(false)
    expect(ephemeral$.persistentEditor.blurRequest.get()).toBe(1)
  })

  it('requestPersistentEditorBlur is monotonic', () => {
    requestPersistentEditorBlur()
    requestPersistentEditorBlur()
    expect(ephemeral$.persistentEditor.blurRequest.get()).toBe(2)
  })
})

describe('setPersistentEditorFocused', () => {
  it('tracks focus and is a no-op for unchanged values', () => {
    setPersistentEditorFocused(true)
    expect(ephemeral$.persistentEditor.isFocused.get()).toBe(true)
    setPersistentEditorFocused(true)
    expect(ephemeral$.persistentEditor.isFocused.get()).toBe(true)
    setPersistentEditorFocused(false)
    expect(ephemeral$.persistentEditor.isFocused.get()).toBe(false)
  })
})

describe('hidePersistentEditor', () => {
  it('returns to screen layout, drops focus/expanded state and blurs', () => {
    showInlineEditor({ content: 'draft' })
    setInlineEditorGeometry({ inlineTop: 300, expandedTop: 60 })
    expandInlineEditor()
    setPersistentEditorFocused(true)
    const blurBefore = ephemeral$.persistentEditor.blurRequest.get()

    hidePersistentEditor()

    const s = ephemeral$.persistentEditor.get()
    expect(s.isVisible).toBe(false)
    expect(s.layoutMode).toBe('screen')
    expect(s.expanded).toBe(false)
    expect(s.isFocused).toBe(false)
    expect(s.initialContent).toBe('')
    expect(s.blurRequest).toBe(blurBefore + 1)
    // Geometry survives so a re-show on the same layout does not flash.
    expect(s.inlineTop).toBe(300)
    expect(s.expandedTop).toBe(60)
  })
})

describe('clearPersistentEditorContent', () => {
  it('empties the document via a revision bump while staying visible', () => {
    showInlineEditor({ content: 'some words' })
    const rev = ephemeral$.persistentEditor.initialContentRevision.get()
    clearPersistentEditorContent()
    const s = ephemeral$.persistentEditor.get()
    expect(s.isVisible).toBe(true)
    expect(s.initialContent).toBe('')
    expect(s.initialContentRevision).toBe(rev + 1)
  })
})
