# WMD v2.1 Pack

## Files

- `wmd-compiler-v2.1.js`
- `example-v2.1.wmd`

## Syntax

```wmd
!note Optional title
Content.
!end

!warning Optional title
Content.
!end

!rule Optional title
Content.
!end
```

```wmd
@collapse Optional title
Hidden content.
@endcollapse
```

```wmd
@toc
@toc depth: 3
```

```wmd
@include Tab Name#Heading
@embed Tab Name#Heading
```

```wmd
@var baseEnergy = 10
Use it like {{baseEnergy}}.
```

```wmd
@tab GM Notes {hidden}
```

You can also hide a tab like this:

```wmd
@tab GM Notes
@hidden
```

Hidden tabs do not appear in the sidebar or heading search, but links and includes can still use them.

## v2.1 fixes

- Removed actual maths rendering and MathJax loading.
- Replaced inline `onclick` / `oninput` HTML with `data-*` attributes and script event listeners.
- This prevents VS Code from complaining about generated `&quot;` inside JavaScript attributes.
