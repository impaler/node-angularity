/**
 * ${NAME} Factory
 *
 * TODO description of this Factory
 *
 * @ngInject
 * Created by ${USER} on ${DATE}.
 */
import bind from 'util/bind';

export default class ${NAME}
{
    constructor($scope)
    {
        extend(${DS}scope, bind(this));

        // private members
        this.something_ = 'something';
    }

    get something() {
        return this.something_;
    }

    set something(value) {
        this.something_ = value;
    }

    method() {
        // TODO
    }

}