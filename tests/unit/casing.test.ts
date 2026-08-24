import { describe, expect, it } from 'vitest';

import {
  pluralize,
  singularize,
  toCamelCase,
  toKebabCase,
  toPascalCase,
  toScreamingSnakeCase,
  toSnakeCase,
  toTitleCase,
} from '../../src/utils/casing.js';

/** Every shape a user, a template or a previous conversion can hand the converters. */
const TWO_WORD_INPUTS = [
  'user profile',
  'user-profile',
  'user_profile',
  'UserProfile',
  'userProfile',
  'USER_PROFILE',
  'user.profile',
  'user   profile',
  '  user profile  ',
  '__user__profile__',
  'User Profile',
] as const;

describe('case converters', () => {
  for (const input of TWO_WORD_INPUTS) {
    it(`normalises '${input}' to every case`, () => {
      expect(toPascalCase(input)).toBe('UserProfile');
      expect(toCamelCase(input)).toBe('userProfile');
      expect(toKebabCase(input)).toBe('user-profile');
      expect(toSnakeCase(input)).toBe('user_profile');
      expect(toScreamingSnakeCase(input)).toBe('USER_PROFILE');
      expect(toTitleCase(input)).toBe('User Profile');
    });
  }

  it('keeps an acronym run together rather than splitting every capital', () => {
    expect(toKebabCase('userHTTPRequest')).toBe('user-http-request');
    expect(toSnakeCase('userHTTPRequest')).toBe('user_http_request');
    expect(toScreamingSnakeCase('userHTTPRequest')).toBe('USER_HTTP_REQUEST');
    expect(toTitleCase('userHTTPRequest')).toBe('User HTTP Request');
  });

  it('preserves an acronym run in the identifier cases', () => {
    expect(toPascalCase('userHTTPRequest')).toBe('UserHTTPRequest');
    expect(toCamelCase('userHTTPRequest')).toBe('userHTTPRequest');
  });

  it('lowers a leading acronym for camel case, where a capital is not allowed', () => {
    expect(toCamelCase('HTTPRequest')).toBe('httpRequest');
    expect(toPascalCase('HTTPRequest')).toBe('HTTPRequest');
    expect(toKebabCase('HTTPRequest')).toBe('http-request');
  });

  it('treats a wholly upper-case word as one word, not as an acronym', () => {
    expect(toPascalCase('USER')).toBe('User');
    expect(toCamelCase('USER')).toBe('user');
    expect(toKebabCase('USER')).toBe('user');
  });

  it('keeps digits attached to the word they belong to', () => {
    expect(toKebabCase('oauth2Client')).toBe('oauth2-client');
    expect(toPascalCase('oauth2 client')).toBe('Oauth2Client');
    expect(toScreamingSnakeCase('apiV2Route')).toBe('API_V2_ROUTE');
  });

  it('is idempotent, so a converted name can be converted again', () => {
    for (const input of ['userHTTPRequest', 'user profile', 'USER_PROFILE']) {
      expect(toPascalCase(toPascalCase(input))).toBe(toPascalCase(input));
      expect(toCamelCase(toCamelCase(input))).toBe(toCamelCase(input));
      expect(toKebabCase(toKebabCase(input))).toBe(toKebabCase(input));
      expect(toSnakeCase(toSnakeCase(input))).toBe(toSnakeCase(input));
      expect(toScreamingSnakeCase(toScreamingSnakeCase(input))).toBe(toScreamingSnakeCase(input));
    }
  });

  it('returns an empty string for input with no words in it', () => {
    for (const input of ['', '   ', '---', '__']) {
      expect(toPascalCase(input)).toBe('');
      expect(toCamelCase(input)).toBe('');
      expect(toKebabCase(input)).toBe('');
      expect(toSnakeCase(input)).toBe('');
      expect(toScreamingSnakeCase(input)).toBe('');
      expect(toTitleCase(input)).toBe('');
    }
  });

  it('handles a single word', () => {
    expect(toPascalCase('user')).toBe('User');
    expect(toCamelCase('User')).toBe('user');
    expect(toKebabCase('user')).toBe('user');
    expect(toTitleCase('user')).toBe('User');
  });
});

describe('pluralize', () => {
  it('turns -y after a consonant into -ies', () => {
    expect(pluralize('category')).toBe('categories');
    expect(pluralize('city')).toBe('cities');
    expect(pluralize('company')).toBe('companies');
  });

  it('leaves -y after a vowel alone', () => {
    expect(pluralize('day')).toBe('days');
    expect(pluralize('key')).toBe('keys');
    expect(pluralize('boy')).toBe('boys');
  });

  it('adds -es after a sibilant', () => {
    expect(pluralize('address')).toBe('addresses');
    expect(pluralize('class')).toBe('classes');
    expect(pluralize('box')).toBe('boxes');
    expect(pluralize('dish')).toBe('dishes');
    expect(pluralize('match')).toBe('matches');
    expect(pluralize('bus')).toBe('buses');
  });

  it('turns -f and -fe into -ves for the words that take it', () => {
    expect(pluralize('leaf')).toBe('leaves');
    expect(pluralize('life')).toBe('lives');
    expect(pluralize('knife')).toBe('knives');
    expect(pluralize('wolf')).toBe('wolves');
    expect(pluralize('shelf')).toBe('shelves');
  });

  it('leaves the -fs words alone, which is why that rule is a list', () => {
    expect(pluralize('roof')).toBe('roofs');
    expect(pluralize('chief')).toBe('chiefs');
    expect(pluralize('belief')).toBe('beliefs');
  });

  it('adds -oes only for the words that take it', () => {
    expect(pluralize('hero')).toBe('heroes');
    expect(pluralize('potato')).toBe('potatoes');
    expect(pluralize('tomato')).toBe('tomatoes');
    expect(pluralize('photo')).toBe('photos');
    expect(pluralize('video')).toBe('videos');
    expect(pluralize('logo')).toBe('logos');
  });

  it('uses the irregular table', () => {
    expect(pluralize('person')).toBe('people');
    expect(pluralize('child')).toBe('children');
    expect(pluralize('man')).toBe('men');
    expect(pluralize('woman')).toBe('women');
    expect(pluralize('tooth')).toBe('teeth');
    expect(pluralize('foot')).toBe('feet');
    expect(pluralize('mouse')).toBe('mice');
    expect(pluralize('goose')).toBe('geese');
    expect(pluralize('datum')).toBe('data');
    expect(pluralize('index')).toBe('indices');
    expect(pluralize('matrix')).toBe('matrices');
    expect(pluralize('analysis')).toBe('analyses');
    expect(pluralize('status')).toBe('statuses');
  });

  it('leaves uncountables as they are', () => {
    for (const word of ['data', 'info', 'news', 'series', 'species', 'equipment', 'media']) {
      expect(pluralize(word)).toBe(word);
    }
  });

  it('leaves an already plural irregular alone instead of doubling it', () => {
    expect(pluralize('people')).toBe('people');
    expect(pluralize('children')).toBe('children');
  });

  it('adds a plain -s otherwise', () => {
    expect(pluralize('user')).toBe('users');
    expect(pluralize('profile')).toBe('profiles');
    expect(pluralize('invoice')).toBe('invoices');
  });

  it('preserves the case style of the word it changes', () => {
    expect(pluralize('user')).toBe('users');
    expect(pluralize('User')).toBe('Users');
    expect(pluralize('USER')).toBe('USERS');
    expect(pluralize('Category')).toBe('Categories');
    expect(pluralize('CATEGORY')).toBe('CATEGORIES');
  });

  it('inflects only the last word of a compound name', () => {
    expect(pluralize('UserProfile')).toBe('UserProfiles');
    expect(pluralize('userProfile')).toBe('userProfiles');
    expect(pluralize('user_profile')).toBe('user_profiles');
    expect(pluralize('user-profile')).toBe('user-profiles');
    expect(pluralize('USER_PROFILE')).toBe('USER_PROFILES');
    expect(pluralize('UserCategory')).toBe('UserCategories');
  });

  it('returns empty input unchanged', () => {
    expect(pluralize('')).toBe('');
  });
});

describe('singularize', () => {
  it('inverts the -ies rule', () => {
    expect(singularize('categories')).toBe('category');
    expect(singularize('cities')).toBe('city');
  });

  it('keeps an -ie singular intact, which the -ies rule alone would mangle', () => {
    expect(singularize('movies')).toBe('movie');
    expect(singularize('cookies')).toBe('cookie');
  });

  it('inverts the -es rule', () => {
    expect(singularize('addresses')).toBe('address');
    expect(singularize('classes')).toBe('class');
    expect(singularize('boxes')).toBe('box');
    expect(singularize('dishes')).toBe('dish');
    expect(singularize('matches')).toBe('match');
    expect(singularize('heroes')).toBe('hero');
  });

  it('distinguishes a singular that already ends in -s from one that does not', () => {
    expect(singularize('buses')).toBe('bus');
    expect(singularize('houses')).toBe('house');
  });

  it('inverts the -ves rule', () => {
    expect(singularize('leaves')).toBe('leaf');
    expect(singularize('lives')).toBe('life');
    expect(singularize('knives')).toBe('knife');
    expect(singularize('wolves')).toBe('wolf');
  });

  it('inverts the irregular table', () => {
    expect(singularize('people')).toBe('person');
    expect(singularize('children')).toBe('child');
    expect(singularize('men')).toBe('man');
    expect(singularize('women')).toBe('woman');
    expect(singularize('teeth')).toBe('tooth');
    expect(singularize('feet')).toBe('foot');
    expect(singularize('mice')).toBe('mouse');
    expect(singularize('geese')).toBe('goose');
    expect(singularize('indices')).toBe('index');
    expect(singularize('matrices')).toBe('matrix');
    expect(singularize('analyses')).toBe('analysis');
    expect(singularize('statuses')).toBe('status');
  });

  it('leaves an already singular table word alone', () => {
    expect(singularize('status')).toBe('status');
    expect(singularize('analysis')).toBe('analysis');
    expect(singularize('person')).toBe('person');
    expect(singularize('user')).toBe('user');
  });

  it('leaves uncountables as they are', () => {
    for (const word of ['info', 'news', 'series', 'species', 'equipment', 'media']) {
      expect(singularize(word)).toBe(word);
    }
  });

  it('answers datum for data, because the irregular table outranks uncountability', () => {
    expect(singularize('data')).toBe('datum');
  });

  it('preserves the case style and the head of a compound name', () => {
    expect(singularize('Users')).toBe('User');
    expect(singularize('USERS')).toBe('USER');
    expect(singularize('UserProfiles')).toBe('UserProfile');
    expect(singularize('user_categories')).toBe('user_category');
    expect(singularize('USER_PROFILES')).toBe('USER_PROFILE');
  });

  it('returns empty input unchanged', () => {
    expect(singularize('')).toBe('');
  });
});

describe('round tripping', () => {
  const WORDS = [
    'user',
    'profile',
    'category',
    'city',
    'day',
    'key',
    'address',
    'class',
    'box',
    'dish',
    'match',
    'bus',
    'house',
    'leaf',
    'life',
    'knife',
    'wolf',
    'shelf',
    'roof',
    'chief',
    'hero',
    'potato',
    'tomato',
    'photo',
    'video',
    'movie',
    'cookie',
    'person',
    'child',
    'man',
    'woman',
    'tooth',
    'foot',
    'mouse',
    'goose',
    'datum',
    'index',
    'matrix',
    'analysis',
    'status',
    'series',
    'media',
    'news',
    'info',
    'equipment',
    'order',
    'invoice',
    'comment',
    'tag',
    'post',
    'company',
    'quiz',
  ] as const;

  for (const word of WORDS) {
    it(`singularize(pluralize('${word}')) === '${word}'`, () => {
      expect(singularize(pluralize(word))).toBe(word);
    });
  }

  it('round trips compound names too', () => {
    for (const word of ['UserProfile', 'userCategory', 'user_address', 'ORDER_STATUS']) {
      expect(singularize(pluralize(word))).toBe(word);
    }
  });
});
