import {
    describe,
    expect,
    test
} from 'vitest';
import { render } from '@testing-library/react'
import {
    ErrorText
} from './ErrorText'


describe('ErrorText', () => {
    test('it renders with the text', () => {
        const { queryByTestId } = render(<ErrorText data-testid="test-id">An Error has occurred!</ErrorText>)
        expect(queryByTestId('test-id')?.textContent).toEqual('An Error has occurred!')
    })
})
