import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'linkify',
  standalone: true,
})
export class LinkifyPipe implements PipeTransform {
  transform(value: string): string {
    if (!value) {
      return '';
    }

    const escaped = value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

    const urlRegex =
      /((?:https?:\/\/|www\.)[^\s<]+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<]*)?)/gi;

    return escaped.replace(urlRegex, (url) => {
      let href = url;

      if (href.toLowerCase().startsWith('www.')) {
        href = `https://${href}`;
      } else if (!/^https?:\/\//i.test(href)) {
        href = `https://${href}`;
      }

      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    });
  }
}
