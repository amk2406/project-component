# 🍞 Toast Notification Component

A modern, lightweight, and accessible toast notification library for JavaScript. Display beautiful toast messages with customizable positions, durations, types, and animations. Fully responsive and supports light/dark themes.

## 📋 Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Examples](#examples)
- [Positioning](#positioning)
- [Theming](#theming)
- [Accessibility](#accessibility)
- [Browser Support](#browser-support)

---

## ✨ Features

- 🎨 **4 Built-in Types** - Success, Error, Warning, and Info notifications
- 📍 **6 Positions** - Top/Bottom + Left/Center/Right combinations
- ⏱️ **Auto-dismiss** - Customizable duration with progress bar
- 🚀 **Smooth Animations** - Elegant slide and fade effects
- 🎯 **Pause on Hover** - Users can pause the auto-dismiss by hovering
- 📱 **Fully Responsive** - Adapts beautifully to mobile screens
- 🌓 **Theme Support** - Built-in light and dark theme
- ♿ **Accessible** - ARIA labels and keyboard friendly
- 🎪 **Max Toasts Limit** - Prevents notification overflow
- 💻 **No Dependencies** - Pure vanilla JavaScript
- 🪶 **Lightweight** - Only ~10KB uncompressed

---

## 📦 Installation

### Option 1: Include via `<script>` tag

```html
<script src="path/to/toast.js"></script>
```

### Option 2: As a Module

```javascript
import Toast from './toast.js';
```

That's it! The `Toast` object is now available globally.

---

## 🚀 Quick Start

### Basic Usage

```javascript
// Success notification (3.5s default)
Toast.success('Saved successfully!');

// Error notification
Toast.error('Something went wrong!');

// Warning notification
Toast.warning('Please check your input');

// Info notification
Toast.info('New update available');

// Custom message with duration
Toast.error('Failed to save', 5000); // 5 seconds
```

### Return Value

All toast methods return an object with methods to control the toast:

```javascript
const notification = Toast.success('Operation completed');

// Close the notification manually
notification.hide();

// Access the DOM element
console.log(notification.el);
```

---

## 📚 API Reference

### Methods

#### `Toast.success(message, [options])`

Display a success notification (green accent).

```javascript
Toast.success('Profile updated!');
Toast.success('Changes saved', 4000);
Toast.success('Done!', { duration: 3000, position: 'top-center' });
```

#### `Toast.error(message, [options])`

Display an error notification (red accent).

```javascript
Toast.error('Failed to load data');
Toast.error('Invalid credentials', 5000);
Toast.error('Network error', { position: 'bottom-left' });
```

#### `Toast.warning(message, [options])`

Display a warning notification (amber accent).

```javascript
Toast.warning('This action cannot be undone');
Toast.warning('Low disk space', 6000);
```

#### `Toast.info(message, [options])`

Display an info notification (blue accent).

```javascript
Toast.info('Update available');
Toast.info('Check back later', { position: 'top-right' });
```

#### `Toast.show(message, [options])`

Display a generic notification (info type by default).

```javascript
Toast.show('New message');
Toast.show('Notification', 4000);
```

#### `Toast.config(options)`

Change global default settings for all toasts.

```javascript
Toast.config({
  duration: 5000,
  position: 'bottom-right',
  maxToasts: 8,
  pauseOnHover: true,
  showProgress: true
});
```

---

## ⚙️ Configuration Options

### Per-Toast Options

You can pass options as the second parameter (either a number for duration, or an object):

```javascript
// As a number (duration in milliseconds)
Toast.error('Message', 4000);

// As an object
Toast.success('Message', {
  duration: 3500,
  position: 'top-right',
  showProgress: true,
  maxToasts: 6,
  pauseOnHover: true
});
```

### Configuration Object

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `duration` | Number | 3500 | How long to show the toast (ms). Set to 0 to keep indefinitely. |
| `position` | String | 'top-right' | Where to display the toast. See [Positioning](#positioning) |
| `showProgress` | Boolean | true | Show the auto-dismiss progress bar |
| `maxToasts` | Number | 6 | Maximum toasts to show at once. Older ones are removed. |
| `pauseOnHover` | Boolean | true | Pause auto-dismiss when hovering over the toast |

### Global Defaults

```javascript
// Set once at app startup
Toast.config({
  duration: 4000,
  position: 'bottom-right',
  maxToasts: 5,
  pauseOnHover: true,
  showProgress: true
});

// All future toasts use these defaults
Toast.success('Uses global config');
```

---

## 📍 Positioning

### Available Positions

```javascript
Toast.success('Top Right', { position: 'top-right' });      // Default
Toast.success('Top Left', { position: 'top-left' });
Toast.success('Top Center', { position: 'top-center' });
Toast.success('Bottom Right', { position: 'bottom-right' });
Toast.success('Bottom Left', { position: 'bottom-left' });
Toast.success('Bottom Center', { position: 'bottom-center' });
```

### Visual Guide

```
┌─────────────────────────────────────────┐
│ top-left    top-center    top-right     │
│                                         │
│                                         │
│ Content Area                            │
│                                         │
│                                         │
│ bottom-left bottom-center bottom-right  │
└─────────────────────────────────────────┘
```

---

## 💬 Examples

### Example 1: Form Submission

```javascript
async function submitForm(formData) {
  try {
    const response = await fetch('/api/save', {
      method: 'POST',
      body: JSON.stringify(formData)
    });
    
    if (response.ok) {
      Toast.success('Profile saved successfully!');
      // Redirect or clear form
    } else {
      Toast.error('Failed to save profile', 4000);
    }
  } catch (error) {
    Toast.error('Network error: ' + error.message, 5000);
  }
}
```

### Example 2: File Upload

```javascript
function handleFileUpload(file) {
  if (file.size > 10 * 1024 * 1024) {
    Toast.warning('File size exceeds 10MB limit');
    return;
  }
  
  const notification = Toast.show('Uploading file...');
  
  // Upload file...
  // After success:
  notification.hide();
  Toast.success('File uploaded successfully!');
}
```

### Example 3: API Call with Error Handling

```javascript
async function fetchUserData(userId) {
  Toast.info('Loading user data...');
  
  try {
    const response = await fetch(`/api/users/${userId}`);
    const data = await response.json();
    
    Toast.success('Data loaded successfully');
    return data;
  } catch (error) {
    Toast.error('Failed to load user data', {
      duration: 5000,
      position: 'top-center'
    });
    return null;
  }
}
```

### Example 4: Form Validation

```javascript
function validateAndSubmit(form) {
  const email = form.email.value;
  
  if (!email.includes('@')) {
    Toast.warning('Please enter a valid email address', {
      position: 'top-center'
    });
    return false;
  }
  
  Toast.success('Form submitted!', 3000);
  return true;
}
```

### Example 5: Keyboard Shortcut

```javascript
document.addEventListener('keydown', (e) => {
  // Ctrl+S to save
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    save();
  }
});

function save() {
  Toast.info('Saving...', { duration: 0 }); // No auto-dismiss
  // Do save...
  setTimeout(() => {
    Toast.success('Saved!');
  }, 1000);
}
```

### Example 6: Persistent Notifications

```javascript
// Show notification without auto-dismiss (duration: 0)
const persistent = Toast.info('Important message', {
  duration: 0,
  position: 'top-center'
});

// User can close it manually
setTimeout(() => {
  persistent.hide();
}, 10000); // Hide after 10 seconds
```

---

## 🎨 Theming

### Light Theme (Default)

Toasts automatically use the light theme on systems with light preference.

```css
/* Light Theme Variables */
--toast-bg: #ffffff;
--toast-text: #1f2937;
--toast-border: #e5e7eb;
--toast-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.08);
--toast-close-hover: #f3f4f6;
```

### Dark Theme

Toasts automatically switch to dark theme on systems with dark preference or when `data-theme="dark"` is set.

```css
/* Dark Theme Variables */
--toast-bg: #1f2937;
--toast-text: #f3f4f6;
--toast-border: #374151;
--toast-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.4);
--toast-close-hover: #374151;
```

### Force Light Theme

```html
<html data-theme="light">
  <!-- Toasts will always use light theme -->
</html>
```

### Force Dark Theme

```html
<html data-theme="dark">
  <!-- Toasts will always use dark theme -->
</html>
```

### Type Colors

Each toast type has its own accent color:

| Type | Color | Hex |
|------|-------|-----|
| Success | Green | `#22c55e` |
| Error | Red | `#ef4444` |
| Warning | Amber | `#f59e0b` |
| Info | Blue | `#3b82f6` |

---

## ♿ Accessibility

The toast component includes accessibility features:

### ARIA Labels

```javascript
// Close button has aria-label="Close"
Toast.success('Message');
```

### Semantic HTML

- Uses proper button elements for close actions
- Semantic SVG icons with proper stroke attributes
- Color-coded for type distinction (not color-only)

### Keyboard Navigation

- Close button is keyboard focusable
- Enter/Space to close toast

### Focus Management

```javascript
// After close, focus returns to trigger element
const notification = Toast.error('Error message');

// User can Tab to close button and press Enter
// Focus returns properly
```

---

## 📱 Responsive Behavior

### Desktop (480px+)

- Toasts positioned at their specified location
- Width: 280px - 420px
- Respects hover interactions

### Mobile (<480px)

```javascript
// Automatically adapts:
// - Full width (stretches to edges)
// - Centered horizontally
// - Stacked vertically
// - Touch-friendly padding
```

---

## 🔧 Advanced Usage

### Chaining Notifications

```javascript
Toast.success('Validation passed');
setTimeout(() => {
  Toast.info('Processing...');
}, 500);
setTimeout(() => {
  Toast.success('All done!');
}, 2000);
```

### Dynamic Content

```javascript
function notifyProgress(current, total) {
  Toast.info(`Loading ${current} of ${total}...`, {
    duration: 2000,
    position: 'bottom-center'
  });
}
```

### Conditional Toast Types

```javascript
function showStatus(status, message) {
  const toastMap = {
    success: Toast.success,
    error: Toast.error,
    warning: Toast.warning,
    info: Toast.info
  };
  
  toastMap[status](message, 4000);
}

showStatus('success', 'It worked!');
showStatus('error', 'Something failed');
```

### Close All Toasts

```javascript
function closeAllToasts() {
  const toasts = document.querySelectorAll('.toast');
  toasts.forEach(toast => {
    if (toast.parentNode) toast.remove();
  });
}
```

---

## 🌐 Browser Support

- Chrome/Edge: ✅ All versions
- Firefox: ✅ All versions
- Safari: ✅ 12+
- Mobile Browsers: ✅ All modern

Requires ES6 support (const, arrow functions). For older browsers, use a transpiler.

---

## ⚡ Performance

- **Lightweight**: ~10KB uncompressed, ~3KB gzipped
- **No Dependencies**: Pure vanilla JavaScript
- **Efficient DOM**: Uses CSS animations (GPU accelerated)
- **Memory**: Old toasts are automatically removed
- **MaxToasts**: Prevents memory leaks from too many notifications

---

## 🐛 Troubleshooting

### Toasts not appearing

Make sure the script is loaded before calling Toast methods:

```html
<script src="toast.js"></script>
<script>
  Toast.success('This works now');
</script>
```

### Styles not applied

Ensure CSS is not overriding the toast styles. Check z-index and positioning.

### Progress bar not showing

Set `showProgress: true` in options (it's enabled by default).

### Toasts disappearing too fast

Increase the `duration`:

```javascript
Toast.success('Message', 5000); // 5 seconds instead of 3.5
```

### Dark theme not working

Set the `data-theme` attribute on the HTML element:

```html
<html data-theme="dark">
```

---

## 📝 License

MIT License - Free to use in personal and commercial projects.

---

## 🙋 Support

For issues, questions, or feature requests, please open an issue on [GitHub](https://github.com/amk2406/project-component/issues).

---

**Happy Notifications! 🎉**
