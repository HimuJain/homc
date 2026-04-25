import type { Task } from '@homc/shared'

export const tasks: Task[] = [
  {
    id: 'create-account',
    goal: 'Create a new account on ShopEase to access member deals',
    preconditions: ['User is on the signup page', 'User has an email address'],
    successCondition: 'A success message, welcome screen, or confirmation text is visible after form submission',
    failureCondition: 'User cannot find the signup form, gets stuck in an error loop, or gives up after repeated failures',
  },
  {
    id: 'find-pricing',
    goal: 'Find the pricing or member plans information on ShopEase',
    preconditions: ['User starts on the ShopEase page'],
    successCondition: 'Pricing tiers or member plans are visible (e.g. Free Plan, Plus Plan, pricing table)',
    failureCondition: 'User cannot locate pricing information after 10 steps',
  },
]
