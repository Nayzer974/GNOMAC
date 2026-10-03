// Tiny arithmetic evaluator for Spotlight. Never uses eval(): a recursive
// descent parser over + - * / % ^ and parentheses, accepting × ÷ and a
// decimal comma so "12,5 × 4" works with a French keyboard.

const OPERATOR = /[+\-*/%^×÷]/;
const ALLOWED = /^[\d\s.,+\-*/%^×÷()]+$/;

export function looksLikeMath(text) {
    const t = text.trim();
    return t.length > 1 && ALLOWED.test(t) && OPERATOR.test(t.replace(/^[-+]/, '')) && /\d/.test(t);
}

export function evaluate(text) {
    const src = text.replace(/×/g, '*').replace(/÷/g, '/').replace(/,/g, '.').replace(/\s+/g, '');
    let pos = 0;

    const peek = () => src[pos];
    const eat = ch => {
        if (src[pos] === ch) {
            pos++;
            return true;
        }
        return false;
    };

    function number() {
        const start = pos;
        while (pos < src.length && /[\d.]/.test(src[pos]))
            pos++;
        if (start === pos)
            throw new Error('number expected');
        const value = Number(src.slice(start, pos));
        if (Number.isNaN(value))
            throw new Error('bad number');
        return value;
    }

    function primary() {
        if (eat('(')) {
            const value = expression();
            if (!eat(')'))
                throw new Error(') expected');
            return value;
        }
        return number();
    }

    function unary() {
        if (eat('-'))
            return -unary();
        if (eat('+'))
            return unary();
        return primary();
    }

    function power() {
        const base = unary();
        // Right associative: 2^3^2 = 2^9.
        return eat('^') ? base ** power() : base;
    }

    function term() {
        let value = power();
        for (;;) {
            if (eat('*'))
                value *= power();
            else if (eat('/'))
                value /= power();
            else if (eat('%'))
                value %= power();
            else
                return value;
        }
    }

    function expression() {
        let value = term();
        for (;;) {
            if (eat('+'))
                value += term();
            else if (eat('-'))
                value -= term();
            else
                return value;
        }
    }

    const value = expression();
    if (pos !== src.length || peek() !== undefined)
        throw new Error('unexpected input');
    if (!Number.isFinite(value))
        throw new Error('not finite');
    return value;
}

export function format(value, decimalComma) {
    const text = String(Number.parseFloat(value.toPrecision(12)));
    return decimalComma ? text.replace('.', ',') : text;
}
